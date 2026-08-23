from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from campus_wall_api.marketplace_schemas import (
    MarketplaceCategory,
    MarketplaceCondition,
    MarketplaceListingCreate,
    MarketplaceTradeMethod,
)
from campus_wall_api.models import MarketplaceListing, Post
from campus_wall_api.schemas import (
    Board,
    LostFoundCategory,
    LostFoundKind,
    PostCreate,
    SeedResult,
)


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
            item_category=LostFoundCategory.DOCUMENTS,
            location="图书馆一楼服务台",
            occurred_at=datetime(2026, 8, 23, 8, 30, tzinfo=UTC),
        ),
    ),
    SeedPost(
        key="welcome-marketplace",
        payload=PostCreate(
            title="出一本九成新的高等数学教材",
            body="书页干净，只有前两章有少量铅笔笔记，适合同校同学当面验书。",
            board=Board.MARKETPLACE,
            author_name="毕业班同学",
            tags=["教材", "二手"],
            marketplace=MarketplaceListingCreate(
                category=MarketplaceCategory.BOOKS,
                condition=MarketplaceCondition.LIKE_NEW,
                price_cents=2800,
                original_price_cents=5980,
                negotiable=True,
                trade_method=MarketplaceTradeMethod.CAMPUS_MEETUP,
                meetup_location="图书馆一楼大厅",
            ),
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
            post = Post(
                title=payload.title,
                body=payload.body,
                board=payload.board.value,
                author_name=payload.author_name,
                anonymous=payload.anonymous,
                tags=list(payload.tags),
                lost_found_kind=payload.kind.value if payload.kind else None,
                lost_found_category=(
                    payload.item_category.value if payload.item_category else None
                ),
                location=payload.location,
                occurred_at=payload.occurred_at,
                resolved=payload.resolved,
                seed_key=seed.key,
            )
            session.add(post)
            session.flush()
            if payload.marketplace is not None:
                session.add(
                    MarketplaceListing(
                        post_id=post.id,
                        seller_user_id=None,
                        category=payload.marketplace.category.value,
                        item_condition=payload.marketplace.condition.value,
                        price_cents=payload.marketplace.price_cents,
                        original_price_cents=(payload.marketplace.original_price_cents),
                        negotiable=payload.marketplace.negotiable,
                        trade_method=payload.marketplace.trade_method.value,
                        meetup_location=payload.marketplace.meetup_location,
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
