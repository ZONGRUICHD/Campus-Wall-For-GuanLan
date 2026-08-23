import base64
import binascii
import json
from dataclasses import dataclass
from datetime import UTC, datetime

from campus_wall_api.schemas import PostSort


class InvalidCursor(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class PageCursor:
    sort: PostSort
    post_id: int
    created_at: datetime
    reaction_count: int


def encode_cursor(cursor: PageCursor) -> str:
    payload = {
        "created_at": cursor.created_at.astimezone(UTC).isoformat(),
        "post_id": cursor.post_id,
        "reaction_count": cursor.reaction_count,
        "sort": cursor.sort.value,
    }
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(value: str, expected_sort: PostSort) -> PageCursor:
    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.b64decode(value + padding, altchars=b"-_", validate=True)
        payload = json.loads(raw)
        sort = PostSort(payload["sort"])
        post_id = int(payload["post_id"])
        reaction_count = int(payload["reaction_count"])
        created_at = datetime.fromisoformat(payload["created_at"])
    except (
        binascii.Error,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        UnicodeDecodeError,
        ValueError,
    ) as exc:
        raise InvalidCursor("cursor is malformed") from exc

    if sort is not expected_sort:
        raise InvalidCursor("cursor sort does not match the request")
    if post_id < 1 or reaction_count < 0:
        raise InvalidCursor("cursor contains an invalid position")
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)

    return PageCursor(
        sort=sort,
        post_id=post_id,
        created_at=created_at.astimezone(UTC),
        reaction_count=reaction_count,
    )

