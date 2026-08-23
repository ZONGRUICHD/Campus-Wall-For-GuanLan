from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.database import session_dependency
from campus_wall_api.models import Comment, Post, Reaction, utc_now
from campus_wall_api.pagination import InvalidCursor, PageCursor, decode_cursor, encode_cursor
from campus_wall_api.schemas import (
    Board,
    CommentCreate,
    CommentRead,
    LostFoundKind,
    LostFoundState,
    PostCreate,
    PostList,
    PostRead,
    PostSort,
    ReactionRead,
    ResolutionRead,
    ResolutionUpdate,
)

ANONYMOUS_AUTHOR = "匿名同学"


def _display_author(author_name: str, anonymous: bool) -> str:
    return ANONYMOUS_AUTHOR if anonymous else author_name


def _post_read(
    post: Post,
    *,
    reaction_count: int = 0,
    liked: bool = False,
    comment_count: int = 0,
    comments: list[CommentRead] | None = None,
) -> PostRead:
    return PostRead(
        id=post.id,
        title=post.title,
        body=post.body,
        board=Board(post.board),
        author_name=_display_author(post.author_name, post.anonymous),
        anonymous=post.anonymous,
        tags=list(post.tags),
        kind=LostFoundKind(post.lost_found_kind) if post.lost_found_kind else None,
        location=post.location,
        resolved=post.resolved,
        reaction_count=reaction_count,
        liked=liked,
        comment_count=comment_count,
        comments=comments or [],
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


def _comment_read(comment: Comment) -> CommentRead:
    return CommentRead(
        id=comment.id,
        post_id=comment.post_id,
        body=comment.body,
        author_name=_display_author(comment.author_name, comment.anonymous),
        anonymous=comment.anonymous,
        created_at=comment.created_at,
    )


def _search_pattern(query: str) -> str:
    escaped = query.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _require_permission(identity: CurrentIdentity, permission: str) -> None:
    if identity.user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "change the initial password before using campus features",
            },
        )
    if permission not in identity.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "permission denied"},
        )


def _cursor_filter(sort: PostSort, cursor: PageCursor, reaction_count: Any) -> Any:
    older_position = or_(
        Post.created_at < cursor.created_at,
        and_(Post.created_at == cursor.created_at, Post.id < cursor.post_id),
    )
    newer_position = or_(
        Post.created_at > cursor.created_at,
        and_(Post.created_at == cursor.created_at, Post.id > cursor.post_id),
    )

    if sort is PostSort.LATEST:
        return older_position
    if sort is PostSort.OLDEST:
        return newer_position
    return or_(
        reaction_count < cursor.reaction_count,
        and_(reaction_count == cursor.reaction_count, older_position),
    )


def create_api_router(
    session_factory: sessionmaker[Session],
    identity_provider: IdentityProvider,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def get_session() -> Iterator[Session]:
        yield from session_dependency(session_factory)

    SessionDependency = Annotated[Session, Depends(get_session, scope="function")]
    IdentityDependency = Annotated[CurrentIdentity, Depends(identity_provider)]

    @router.get("/posts", response_model=PostList)
    def list_posts(
        session: SessionDependency,
        identity: IdentityDependency,
        board: Annotated[Board | None, Query()] = None,
        query: Annotated[str | None, Query(max_length=200)] = None,
        sort: Annotated[PostSort, Query()] = PostSort.LATEST,
        lost_found_state: Annotated[LostFoundState | None, Query()] = None,
        cursor: Annotated[str | None, Query(max_length=1000)] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
    ) -> PostList:
        _require_permission(identity, "content:interact")
        cursor_data: PageCursor | None = None
        if cursor:
            try:
                cursor_data = decode_cursor(cursor, sort)
            except InvalidCursor as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "invalid_cursor", "message": str(exc)},
                ) from exc

        reaction_stats = (
            select(
                Reaction.post_id.label("post_id"),
                func.count(Reaction.actor).label("reaction_count"),
                func.max(case((Reaction.actor == identity.user.id, 1), else_=0)).label("liked"),
            )
            .group_by(Reaction.post_id)
            .subquery()
        )
        comment_stats = (
            select(
                Comment.post_id.label("post_id"),
                func.count(Comment.id).label("comment_count"),
            )
            .where(Comment.status == "published")
            .group_by(Comment.post_id)
            .subquery()
        )
        reaction_count = func.coalesce(reaction_stats.c.reaction_count, 0)
        liked = func.coalesce(reaction_stats.c.liked, 0)
        comment_count = func.coalesce(comment_stats.c.comment_count, 0)

        statement = (
            select(
                Post,
                reaction_count.label("reaction_count"),
                liked.label("liked"),
                comment_count.label("comment_count"),
            )
            .outerjoin(reaction_stats, reaction_stats.c.post_id == Post.id)
            .outerjoin(comment_stats, comment_stats.c.post_id == Post.id)
            .where(Post.status == "published")
        )

        if board is not None:
            statement = statement.where(Post.board == board.value)

        normalized_query = query.strip() if query else ""
        if normalized_query:
            pattern = _search_pattern(normalized_query)
            statement = statement.where(
                or_(
                    func.lower(func.coalesce(Post.title, "")).like(pattern, escape="\\"),
                    func.lower(Post.body).like(pattern, escape="\\"),
                    func.lower(Post.author_name).like(pattern, escape="\\"),
                    func.lower(func.coalesce(Post.location, "")).like(pattern, escape="\\"),
                    func.lower(cast(Post.tags, String)).like(pattern, escape="\\"),
                )
            )

        if lost_found_state is not None:
            statement = statement.where(Post.board == Board.LOST_FOUND.value)
            if lost_found_state is not LostFoundState.ALL:
                statement = statement.where(
                    Post.resolved.is_(lost_found_state is LostFoundState.RESOLVED)
                )

        if cursor_data is not None:
            statement = statement.where(_cursor_filter(sort, cursor_data, reaction_count))

        if sort is PostSort.LATEST:
            statement = statement.order_by(Post.created_at.desc(), Post.id.desc())
        elif sort is PostSort.OLDEST:
            statement = statement.order_by(Post.created_at.asc(), Post.id.asc())
        else:
            statement = statement.order_by(
                reaction_count.desc(), Post.created_at.desc(), Post.id.desc()
            )

        with session.begin():
            rows = session.execute(statement.limit(limit + 1)).all()
            page_rows = rows[:limit]
            page_post_ids = [post.id for post, *_ in page_rows]
            comments_by_post: dict[int, list[CommentRead]] = {
                post_id: [] for post_id in page_post_ids
            }
            if page_post_ids:
                page_comments = session.scalars(
                    select(Comment)
                    .where(
                        Comment.post_id.in_(page_post_ids),
                        Comment.status == "published",
                    )
                    .order_by(Comment.created_at.asc(), Comment.id.asc())
                ).all()
                for comment in page_comments:
                    comments_by_post[comment.post_id].append(_comment_read(comment))

            items = [
                _post_read(
                    post,
                    reaction_count=int(row_reaction_count),
                    liked=bool(row_liked),
                    comment_count=int(row_comment_count),
                    comments=comments_by_post[post.id],
                )
                for post, row_reaction_count, row_liked, row_comment_count in page_rows
            ]

            next_cursor = None
            if len(rows) > limit and page_rows:
                last_post, last_reaction_count, _, _ = page_rows[-1]
                next_cursor = encode_cursor(
                    PageCursor(
                        sort=sort,
                        post_id=last_post.id,
                        created_at=last_post.created_at,
                        reaction_count=int(last_reaction_count),
                    )
                )

        return PostList(items=items, next_cursor=next_cursor)

    @router.post("/posts", response_model=PostRead, status_code=status.HTTP_201_CREATED)
    def create_post(
        payload: PostCreate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> PostRead:
        _require_permission(identity, "content:create")
        with session.begin():
            post = Post(
                title=payload.title,
                body=payload.body,
                board=payload.board.value,
                author_name=identity.user.display_name,
                author_user_id=identity.user.id,
                anonymous=payload.anonymous,
                tags=list(payload.tags),
                lost_found_kind=payload.kind.value if payload.kind else None,
                location=payload.location,
                resolved=payload.resolved,
            )
            session.add(post)
            session.flush()
            response = _post_read(post)
        return response

    @router.post("/posts/{post_id}/reactions", response_model=ReactionRead)
    def toggle_reaction(
        post_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> ReactionRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            existing_post = session.scalar(
                select(Post.id)
                .where(Post.id == post_id, Post.status == "published")
                .with_for_update()
            )
            if existing_post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")

            reaction = session.get(
                Reaction,
                {"post_id": post_id, "actor": identity.user.id},
            )
            if reaction is None:
                session.add(Reaction(post_id=post_id, actor=identity.user.id))
                liked_value = True
            else:
                session.delete(reaction)
                liked_value = False

            session.flush()
            count = session.scalar(
                select(func.count(Reaction.actor)).where(Reaction.post_id == post_id)
            )
            response = ReactionRead(
                post_id=post_id,
                reaction_count=int(count or 0),
                liked=liked_value,
            )
        return response

    @router.post(
        "/posts/{post_id}/comments",
        response_model=CommentRead,
        status_code=status.HTTP_201_CREATED,
    )
    def create_comment(
        post_id: int,
        payload: CommentCreate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> CommentRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            existing_post = session.scalar(
                select(Post.id).where(
                    Post.id == post_id,
                    Post.status == "published",
                )
            )
            if existing_post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")

            comment = Comment(
                post_id=post_id,
                body=payload.body,
                author_name=identity.user.display_name,
                author_user_id=identity.user.id,
                anonymous=payload.anonymous,
            )
            session.add(comment)
            session.flush()
            response = _comment_read(comment)
        return response

    @router.patch("/posts/{post_id}/resolution", response_model=ResolutionRead)
    def update_resolution(
        post_id: int,
        payload: ResolutionUpdate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> ResolutionRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            post = session.scalar(
                select(Post).where(Post.id == post_id, Post.status == "published").with_for_update()
            )
            if post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")
            if post.board != Board.LOST_FOUND.value:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={
                        "code": "board_does_not_support_resolution",
                        "message": "only lost_found posts have a resolution state",
                    },
                )
            if (
                post.author_user_id != identity.user.id
                and "content:moderate" not in identity.permissions
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "forbidden",
                        "message": "only the author or a moderator can update this item",
                    },
                )

            post.resolved = payload.resolved
            post.updated_at = utc_now()
            session.flush()
            response = ResolutionRead(
                post_id=post.id,
                resolved=post.resolved,
                updated_at=post.updated_at,
            )
        return response

    return router
