"""add episode air status time and provider cursor

Revision ID: 202607230001
Revises: 202607220001
Create Date: 2026-07-23 00:01:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '202607230001'
down_revision: str | None = '202607220001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('episode') as batch_op:
        batch_op.add_column(sa.Column('provider_external_id', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('status_air_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index('ix_episode_provider_external_id', ['provider_external_id'], unique=False)
        batch_op.create_index('ix_episode_status_status_air_at', ['status', 'status_air_at'], unique=False)
    op.execute('UPDATE episode SET status_air_at = air_at WHERE air_at_has_time = true')
    op.create_table(
        'provider_sync_cursor',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=64), nullable=False),
        sa.Column('stream', sa.String(length=64), nullable=False),
        sa.Column('cursor_timestamp', sa.BigInteger(), nullable=False),
        sa.Column('cursor_page', sa.Integer(), server_default='0', nullable=False),
        sa.Column('lease_owner', sa.String(length=64), nullable=True),
        sa.Column('lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_succeeded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(length=1024), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('provider', 'stream', name='uq_provider_sync_cursor_provider_stream'),
    )


def downgrade() -> None:
    op.drop_table('provider_sync_cursor')
    with op.batch_alter_table('episode') as batch_op:
        batch_op.drop_index('ix_episode_status_status_air_at')
        batch_op.drop_index('ix_episode_provider_external_id')
        batch_op.drop_column('status_air_at')
        batch_op.drop_column('provider_external_id')
