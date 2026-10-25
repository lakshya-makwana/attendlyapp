"""add_account_id_to_models

Revision ID: b1c4e7f8a9d0
Revises: 2d5b44a48e8f
Create Date: 2026-10-25 21:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c4e7f8a9d0'
down_revision: Union[str, Sequence[str], None] = '2d5b44a48e8f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add account_id columns with foreign keys
    op.add_column("workers", sa.Column("account_id", sa.String(length=36), nullable=True))
    op.create_foreign_key("fk_workers_account_id", "workers", "accounts", ["account_id"], ["id"], ondelete="CASCADE")
    op.create_index(op.f("ix_workers_account_id"), "workers", ["account_id"], unique=False)

    op.add_column("sites", sa.Column("account_id", sa.String(length=36), nullable=True))
    op.create_foreign_key("fk_sites_account_id", "sites", "accounts", ["account_id"], ["id"], ondelete="CASCADE")
    op.create_index(op.f("ix_sites_account_id"), "sites", ["account_id"], unique=False)

    op.add_column("attendance", sa.Column("account_id", sa.String(length=36), nullable=True))
    op.create_foreign_key("fk_attendance_account_id", "attendance", "accounts", ["account_id"], ["id"], ondelete="CASCADE")
    op.create_index(op.f("ix_attendance_account_id"), "attendance", ["account_id"], unique=False)

    op.add_column("worker_wage_history", sa.Column("account_id", sa.String(length=36), nullable=True))
    op.create_foreign_key("fk_worker_wage_history_account_id", "worker_wage_history", "accounts", ["account_id"], ["id"], ondelete="CASCADE")
    op.create_index(op.f("ix_worker_wage_history_account_id"), "worker_wage_history", ["account_id"], unique=False)

    # 2. Backfill existing rows with current contractor account ID if accounts exist
    op.execute("UPDATE workers SET account_id = (SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1) WHERE account_id IS NULL;")
    op.execute("UPDATE sites SET account_id = (SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1) WHERE account_id IS NULL;")
    op.execute("UPDATE attendance SET account_id = (SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1) WHERE account_id IS NULL;")
    op.execute("UPDATE worker_wage_history SET account_id = (SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1) WHERE account_id IS NULL;")
    op.execute("UPDATE advances SET account_id = (SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1) WHERE account_id IS NULL;")


def downgrade() -> None:
    op.drop_index(op.f("ix_worker_wage_history_account_id"), table_name="worker_wage_history")
    op.drop_constraint("fk_worker_wage_history_account_id", "worker_wage_history", type_="foreignkey")
    op.drop_column("worker_wage_history", "account_id")

    op.drop_index(op.f("ix_attendance_account_id"), table_name="attendance")
    op.drop_constraint("fk_attendance_account_id", "attendance", type_="foreignkey")
    op.drop_column("attendance", "account_id")

    op.drop_index(op.f("ix_sites_account_id"), table_name="sites")
    op.drop_constraint("fk_sites_account_id", "sites", type_="foreignkey")
    op.drop_column("sites", "account_id")

    op.drop_index(op.f("ix_workers_account_id"), table_name="workers")
    op.drop_constraint("fk_workers_account_id", "workers", type_="foreignkey")
    op.drop_column("workers", "account_id")
