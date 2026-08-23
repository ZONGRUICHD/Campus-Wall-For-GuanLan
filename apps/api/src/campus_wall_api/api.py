import secrets
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import String, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.access_control import audit_event
from campus_wall_api.auth import CurrentIdentity, IdentityProvider
from campus_wall_api.config import Settings
from campus_wall_api.database import session_dependency
from campus_wall_api.models import (
    Comment,
    CommentReaction,
    Post,
    PostBookmark,
    Reaction,
    utc_now,
)
from campus_wall_api.pagination import InvalidCursor, PageCursor, decode_cursor, encode_cursor
from campus_wall_api.schemas import (
    Board,
    BookmarkRead,
    CommentCreate,
    CommentReactionRead,
    CommentRead,
    CommentUpdate,
    LostFoundKind,
    LostFoundState,
    PostCreate,
    PostList,
    PostRead,
    PostSort,
    PostUpdate,
    PublicationStatus,
    PublishDueResult,
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
    bookmarked: bool = False,
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
        publication_status=PublicationStatus(post.publication_status),
        scheduled_for=post.scheduled_for,
        edited_at=post.edited_at,
        comments_enabled=post.comments_enabled,
        reaction_count=reaction_count,
        liked=liked,
        bookmarked=bookmarked,
        comment_count=comment_count,
        comments=comments or [],
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


def _comment_read(
    comment: Comment,
    *,
    reaction_count: int = 0,
    liked: bool = False,
) -> CommentRead:
    return CommentRead(
        id=comment.id,
        post_id=comment.post_id,
        body=comment.body,
        author_name=_display_author(comment.author_name, comment.anonymous),
        anonymous=comment.anonymous,
        parent_id=comment.parent_id,
        depth=comment.depth,
        reaction_count=reaction_count,
        liked=liked,
        edited_at=comment.edited_at,
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
    settings: Settings,
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
        bookmark_stats = (
            select(
                PostBookmark.post_id.label("post_id"),
                func.count(PostBookmark.user_id).label("bookmark_count"),
            )
            .where(PostBookmark.user_id == identity.user.id)
            .group_by(PostBookmark.post_id)
            .subquery()
        )
        reaction_count = func.coalesce(reaction_stats.c.reaction_count, 0)
        liked = func.coalesce(reaction_stats.c.liked, 0)
        comment_count = func.coalesce(comment_stats.c.comment_count, 0)
        bookmarked = func.coalesce(bookmark_stats.c.bookmark_count, 0)

        statement = (
            select(
                Post,
                reaction_count.label("reaction_count"),
                liked.label("liked"),
                comment_count.label("comment_count"),
                bookmarked.label("bookmarked"),
            )
            .outerjoin(reaction_stats, reaction_stats.c.post_id == Post.id)
            .outerjoin(comment_stats, comment_stats.c.post_id == Post.id)
            .outerjoin(bookmark_stats, bookmark_stats.c.post_id == Post.id)
            .where(
                Post.status == "published",
                Post.publication_status == "published",
            )
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
                comment_reaction_stats = (
                    select(
                        CommentReaction.comment_id.label("comment_id"),
                        func.count(CommentReaction.user_id).label("reaction_count"),
                        func.max(
                            case(
                                (
                                    CommentReaction.user_id == identity.user.id,
                                    1,
                                ),
                                else_=0,
                            )
                        ).label("liked"),
                    )
                    .group_by(CommentReaction.comment_id)
                    .subquery()
                )
                page_comments = session.execute(
                    select(
                        Comment,
                        func.coalesce(
                            comment_reaction_stats.c.reaction_count,
                            0,
                        ),
                        func.coalesce(comment_reaction_stats.c.liked, 0),
                    )
                    .outerjoin(
                        comment_reaction_stats,
                        comment_reaction_stats.c.comment_id == Comment.id,
                    )
                    .where(
                        Comment.post_id.in_(page_post_ids),
                        Comment.status == "published",
                    )
                    .order_by(Comment.created_at.asc(), Comment.id.asc())
                ).all()
                for comment, row_reaction_count, row_liked in page_comments:
                    comments_by_post[comment.post_id].append(
                        _comment_read(
                            comment,
                            reaction_count=int(row_reaction_count),
                            liked=bool(row_liked),
                        )
                    )

            items = [
                _post_read(
                    post,
                    reaction_count=int(row_reaction_count),
                    liked=bool(row_liked),
                    bookmarked=bool(row_bookmarked),
                    comment_count=int(row_comment_count),
                    comments=comments_by_post[post.id],
                )
                for (
                    post,
                    row_reaction_count,
                    row_liked,
                    row_comment_count,
                    row_bookmarked,
                ) in page_rows
            ]

            next_cursor = None
            if len(rows) > limit and page_rows:
                last_post, last_reaction_count, _, _, _ = page_rows[-1]
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
        now = utc_now()
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
                publication_status=payload.publication_status.value,
                scheduled_for=payload.scheduled_for,
                published_at=(
                    now if payload.publication_status is PublicationStatus.PUBLISHED else None
                ),
                comments_enabled=payload.comments_enabled,
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
                .where(
                    Post.id == post_id,
                    Post.status == "published",
                    Post.publication_status == "published",
                )
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
                select(Post).where(
                    Post.id == post_id,
                    Post.status == "published",
                    Post.publication_status == "published",
                    Post.comments_enabled.is_(True),
                )
            )
            if existing_post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")
            parent: Comment | None = None
            depth = 0
            if payload.parent_id is not None:
                parent = session.get(Comment, payload.parent_id)
                if parent is None or parent.post_id != post_id or parent.status != "published":
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="parent comment not found",
                    )
                depth = parent.depth + 1
                if depth > 2:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="comment nesting cannot exceed two reply levels",
                    )

            comment = Comment(
                post_id=post_id,
                parent_id=parent.id if parent else None,
                depth=depth,
                body=payload.body,
                author_name=identity.user.display_name,
                author_user_id=identity.user.id,
                anonymous=payload.anonymous,
            )
            session.add(comment)
            session.flush()
            response = _comment_read(comment)
        return response

    @router.get("/posts/me", response_model=PostList)
    def list_my_posts(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> PostList:
        _require_permission(identity, "content:create")
        with session.begin():
            posts = session.scalars(
                select(Post)
                .where(
                    Post.author_user_id == identity.user.id,
                    Post.status != "deleted",
                )
                .order_by(Post.created_at.desc())
                .limit(100)
            ).all()
            return PostList(
                items=[_post_read(post) for post in posts],
                next_cursor=None,
            )

    @router.patch("/posts/{post_id}", response_model=PostRead)
    def update_post(
        post_id: int,
        payload: PostUpdate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> PostRead:
        _require_permission(identity, "content:create")
        changes = payload.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="at least one post field is required",
            )
        with session.begin():
            post = session.scalar(select(Post).where(Post.id == post_id).with_for_update())
            if post is None or post.status == "deleted":
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="post not found",
                )
            if (
                post.author_user_id != identity.user.id
                and "content:moderate" not in identity.permissions
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="only the author can edit this post",
                )
            if (
                "title" in changes
                and changes["title"] is None
                and post.board in {Board.NEWS.value, Board.LOST_FOUND.value}
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="this board requires a title",
                )

            now = utc_now()
            publication_status = changes.pop("publication_status", None)
            scheduled_for = changes.pop("scheduled_for", None)
            for field, value in changes.items():
                if field == "tags" and value is not None:
                    value = list(dict.fromkeys(value))
                setattr(post, field, value)

            if publication_status is not None:
                next_publication_status = publication_status.value
                post.publication_status = next_publication_status
                if next_publication_status == "published":
                    post.scheduled_for = None
                    post.published_at = post.published_at or now
                elif next_publication_status == "scheduled":
                    post.scheduled_for = scheduled_for
                    post.published_at = None
                else:
                    post.scheduled_for = None
                    post.published_at = None
            elif scheduled_for is not None:
                if post.publication_status != "scheduled":
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail="scheduled_for requires a scheduled post",
                    )
                post.scheduled_for = scheduled_for

            post.edited_at = now
            post.updated_at = now
            audit_event(
                session,
                action="content.post_updated",
                target_type="post",
                target_id=str(post.id),
                actor_user_id=identity.user.id,
                details={"fields": sorted(payload.model_fields_set)},
            )
            session.flush()
            return _post_read(post)

    @router.delete(
        "/posts/{post_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def delete_post(
        post_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_permission(identity, "content:create")
        with session.begin():
            post = session.scalar(select(Post).where(Post.id == post_id).with_for_update())
            if post is None or post.status == "deleted":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if (
                post.author_user_id != identity.user.id
                and "content:moderate" not in identity.permissions
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            post.status = "deleted"
            post.updated_at = utc_now()
            audit_event(
                session,
                action="content.post_deleted",
                target_type="post",
                target_id=str(post.id),
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/posts/{post_id}/bookmark", response_model=BookmarkRead)
    def toggle_bookmark(
        post_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> BookmarkRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            post = session.scalar(
                select(Post.id).where(
                    Post.id == post_id,
                    Post.status == "published",
                    Post.publication_status == "published",
                )
            )
            if post is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            bookmark = session.get(
                PostBookmark,
                {"post_id": post_id, "user_id": identity.user.id},
            )
            if bookmark is None:
                session.add(
                    PostBookmark(
                        post_id=post_id,
                        user_id=identity.user.id,
                    )
                )
                bookmarked = True
            else:
                session.delete(bookmark)
                bookmarked = False
            return BookmarkRead(post_id=post_id, bookmarked=bookmarked)

    @router.get("/bookmarks", response_model=PostList)
    def list_bookmarks(
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> PostList:
        _require_permission(identity, "content:interact")
        with session.begin():
            posts = session.scalars(
                select(Post)
                .join(PostBookmark, PostBookmark.post_id == Post.id)
                .where(
                    PostBookmark.user_id == identity.user.id,
                    Post.status == "published",
                    Post.publication_status == "published",
                )
                .order_by(PostBookmark.created_at.desc())
                .limit(100)
            ).all()
            return PostList(
                items=[_post_read(post, bookmarked=True) for post in posts],
                next_cursor=None,
            )

    @router.post(
        "/comments/{comment_id}/reactions",
        response_model=CommentReactionRead,
    )
    def toggle_comment_reaction(
        comment_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> CommentReactionRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            comment = session.get(Comment, comment_id)
            if comment is None or comment.status != "published":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            reaction = session.get(
                CommentReaction,
                {"comment_id": comment_id, "user_id": identity.user.id},
            )
            if reaction is None:
                session.add(
                    CommentReaction(
                        comment_id=comment_id,
                        user_id=identity.user.id,
                    )
                )
                liked = True
            else:
                session.delete(reaction)
                liked = False
            session.flush()
            count = int(
                session.scalar(
                    select(func.count(CommentReaction.user_id)).where(
                        CommentReaction.comment_id == comment_id
                    )
                )
                or 0
            )
            return CommentReactionRead(
                comment_id=comment_id,
                reaction_count=count,
                liked=liked,
            )

    @router.patch("/comments/{comment_id}", response_model=CommentRead)
    def update_comment(
        comment_id: int,
        payload: CommentUpdate,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> CommentRead:
        _require_permission(identity, "content:interact")
        with session.begin():
            comment = session.scalar(
                select(Comment).where(Comment.id == comment_id).with_for_update()
            )
            if comment is None or comment.status != "published":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if (
                comment.author_user_id != identity.user.id
                and "content:moderate" not in identity.permissions
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            comment.body = payload.body
            comment.edited_at = utc_now()
            audit_event(
                session,
                action="content.comment_updated",
                target_type="comment",
                target_id=str(comment.id),
                actor_user_id=identity.user.id,
            )
            session.flush()
            return _comment_read(comment)

    @router.delete(
        "/comments/{comment_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def delete_comment(
        comment_id: int,
        session: SessionDependency,
        identity: IdentityDependency,
    ) -> Response:
        _require_permission(identity, "content:interact")
        with session.begin():
            comment = session.scalar(
                select(Comment).where(Comment.id == comment_id).with_for_update()
            )
            if comment is None or comment.status == "deleted":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            if (
                comment.author_user_id != identity.user.id
                and "content:moderate" not in identity.permissions
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
            comment.status = "deleted"
            audit_event(
                session,
                action="content.comment_deleted",
                target_type="comment",
                target_id=str(comment.id),
                actor_user_id=identity.user.id,
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/internal/publish-due", response_model=PublishDueResult)
    def publish_due_posts(
        authorization: Annotated[str | None, Header()] = None,
    ) -> PublishDueResult:
        expected = f"Bearer {settings.cron_secret.get_secret_value()}"
        if authorization is None or not secrets.compare_digest(
            authorization,
            expected,
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        now = datetime.now(UTC)
        with session_factory() as session, session.begin():
            posts = session.scalars(
                select(Post)
                .where(
                    Post.publication_status == "scheduled",
                    Post.scheduled_for.is_not(None),
                    Post.scheduled_for <= now,
                    Post.status == "published",
                )
                .order_by(Post.scheduled_for.asc())
                .limit(100)
                .with_for_update(skip_locked=True)
            ).all()
            for post in posts:
                post.publication_status = "published"
                post.published_at = now
                post.scheduled_for = None
                post.updated_at = now
                audit_event(
                    session,
                    action="content.scheduled_published",
                    target_type="post",
                    target_id=str(post.id),
                    actor_user_id=None,
                )
            return PublishDueResult(published=len(posts))

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
                select(Post)
                .where(
                    Post.id == post_id,
                    Post.status == "published",
                    Post.publication_status == "published",
                )
                .with_for_update()
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
