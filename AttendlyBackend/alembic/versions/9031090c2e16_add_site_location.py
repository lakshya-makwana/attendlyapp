"""add_site_location

Revision ID: 9031090c2e16
Revises: 58b126029c1d
Create Date: 2026-10-25 13:37:09.491657

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9031090c2e16'
down_revision: Union[str, Sequence[str], None] = '58b126029c1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sites', sa.Column('location', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sites', 'location')
