"""create_advances_table

Revision ID: 2d5b44a48e8f
Revises: 9031090c2e16
Create Date: 2026-10-25 13:57:15.052065

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2d5b44a48e8f'
down_revision: Union[str, Sequence[str], None] = '9031090c2e16'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "advances",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("worker_id", sa.String(length=36), nullable=False),
        sa.Column("amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["worker_id"], ["workers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_advances_account_id"), "advances", ["account_id"], unique=False)
    op.create_index(op.f("ix_advances_worker_id"), "advances", ["worker_id"], unique=False)
    op.create_index(op.f("ix_advances_date"), "advances", ["date"], unique=False)
    op.create_index("ix_advances_worker_date", "advances", ["worker_id", "date"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_advances_worker_date", table_name="advances")
    op.drop_index(op.f("ix_advances_date"), table_name="advances")
    op.drop_index(op.f("ix_advances_worker_id"), table_name="advances")
    op.drop_index(op.f("ix_advances_account_id"), table_name="advances")
    op.drop_table("advances")
