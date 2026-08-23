from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.models import Post
from campus_wall_api.schemas import Board, LostFoundKind, PostCreate, SeedResult


@dataclass(frozen=True, slots=True)
class SeedPost:
    key: str
    payload: PostCreate


SEED_POSTS = (
    SeedPost(
        key="welcome-news",
        payload=PostCreate(
            title="校园墙上线啦",
            body="欢迎在这里查看校园资讯，也欢迎分享你关心的校园动态。",
            board=Board.NEWS,
            author_name="校园墙",
            tags=["公告"],
        ),
    ),
    SeedPost(
        key="welcome-daily",
        payload=PostCreate(
            title="今天的校园晚霞",
            body="操场边的晚霞很好看，分享给路过校园墙的你。",
            board=Board.DAILY,
            author_name="观澜同学",
            tags=["校园日常"],
        ),
    ),
    SeedPost(
        key="welcome-lost-found",
        payload=PostCreate(
            title="捡到一张校园卡",
            body="在图书馆一楼捡到校园卡，请失主核对信息后领取。",
            board=Board.LOST_FOUND,
            author_name="热心同学",
            tags=["校园卡"],
            kind=LostFoundKind.FOUND,
            location="图书馆一楼服务台",
        ),
    ),
    SeedPost(
        key="welcome-confession",
        payload=PostCreate(
            title="谢谢雨天借伞的你",
            body="想谢谢上周在教学楼门口借我伞的同学，希望还能遇见你。",
            board=Board.CONFESSION,
            anonymous=True,
            tags=["感谢"],
        ),
    ),
    SeedPost(
        key="welcome-tree-hole",
        payload=PostCreate(
            title="第一次发树洞",
            body="最近有点忙，但完成一件小事也值得给自己一点鼓励。",
            board=Board.TREE_HOLE,
            anonymous=True,
            tags=["心情"],
        ),
    ),
)


def seed_database(session_factory: sessionmaker[Session]) -> SeedResult:
    """Insert each stable seed independently so an interrupted run can resume."""

    inserted = 0
    for seed in SEED_POSTS:
        with session_factory() as session, session.begin():
            existing_id = session.scalar(select(Post.id).where(Post.seed_key == seed.key))
            if existing_id is not None:
                continue

            payload = seed.payload
            session.add(
                Post(
                    title=payload.title,
                    body=payload.body,
                    board=payload.board.value,
                    author_name=payload.author_name,
                    anonymous=payload.anonymous,
                    tags=list(payload.tags),
                    lost_found_kind=payload.kind.value if payload.kind else None,
                    location=payload.location,
                    resolved=payload.resolved,
                    seed_key=seed.key,
                )
            )
            inserted += 1

    with session_factory() as session, session.begin():
        total = session.scalar(select(func.count(Post.id)).where(Post.seed_key.is_not(None)))

    seed_total = int(total or 0)
    return SeedResult(
        inserted=inserted,
        existing=len(SEED_POSTS) - inserted,
        total=seed_total,
    )
