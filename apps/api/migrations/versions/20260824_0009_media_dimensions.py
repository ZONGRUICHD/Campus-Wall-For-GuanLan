"""Record sanitized image dimensions.

Revision ID: 20260824_0009
Revises: 20260824_0008
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0009"
down_revision: str | None = "20260824_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("media_assets") as batch_op:
        batch_op.add_column(sa.Column("pixel_width", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("pixel_height", sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            "ck_media_assets_dimensions",
            "(pixel_width IS NULL AND pixel_height IS NULL) OR "
            "(pixel_width > 0 AND pixel_height > 0)",
        )


def downgrade() -> None:
    with op.batch_alter_table("media_assets") as batch_op:
        batch_op.drop_constraint("ck_media_assets_dimensions", type_="check")
        batch_op.drop_column("pixel_height")
        batch_op.drop_column("pixel_width")
