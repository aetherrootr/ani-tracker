"""deduplicate anime poster resources

Revision ID: 202607250001
Revises: 202607230001
Create Date: 2026-07-25 00:01:00.000000
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '202607250001'
down_revision: str | None = '202607230001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'anime_poster_resource',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_key', sa.String(length=64), nullable=False),
        sa.Column('source_url', sa.String(length=2048), nullable=True),
        sa.Column('storage_path', sa.String(length=512), nullable=False),
        sa.Column('mime_type', sa.String(length=64), server_default='', nullable=False),
        sa.Column('size_bytes', sa.Integer(), server_default='0', nullable=False),
        sa.Column('status', sa.String(length=32), server_default='pending', nullable=False),
        sa.Column('last_error', sa.String(length=1024), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_key'),
        sa.UniqueConstraint('storage_path'),
    )

    connection = op.get_bind()
    posters = connection.execute(
        sa.text(
            'SELECT id, source_url, storage_path, mime_type, size_bytes, status, last_error '
            "FROM anime_poster ORDER BY CASE WHEN status = 'ready' THEN 0 ELSE 1 END, id",
        ),
    ).mappings().all()
    resource_ids: dict[str, int] = {}
    poster_resources: dict[int, int] = {}
    resource_table = sa.table(
        'anime_poster_resource',
        sa.column('id', sa.Integer),
        sa.column('source_key', sa.String),
        sa.column('source_url', sa.String),
        sa.column('storage_path', sa.String),
        sa.column('mime_type', sa.String),
        sa.column('size_bytes', sa.Integer),
        sa.column('status', sa.String),
        sa.column('last_error', sa.String),
    )
    for poster in posters:
        resource_identity = poster['source_url'] or f'legacy://anime-poster/{poster["id"]}'
        resource_id = resource_ids.get(resource_identity)
        if resource_id is None:
            resource_id = connection.execute(
                resource_table.insert()
                .values(
                    source_key=hashlib.sha256(resource_identity.encode()).hexdigest(),
                    source_url=poster['source_url'],
                    storage_path=poster['storage_path'],
                    mime_type=poster['mime_type'],
                    size_bytes=poster['size_bytes'],
                    status=poster['status'],
                    last_error=poster['last_error'],
                )
                .returning(resource_table.c.id),
            ).scalar_one()
            resource_ids[resource_identity] = resource_id
        poster_resources[poster['id']] = resource_id

    with op.batch_alter_table('anime_poster') as batch_op:
        batch_op.drop_constraint('uq_anime_poster_anime_id_storage_path', type_='unique')
        batch_op.add_column(sa.Column('resource_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('role', sa.String(length=32), server_default='primary', nullable=False))
        batch_op.add_column(sa.Column('priority', sa.Integer(), server_default='0', nullable=False))
    for poster_id, resource_id in poster_resources.items():
        connection.execute(
            sa.text('UPDATE anime_poster SET resource_id = :resource_id WHERE id = :poster_id'),
            {'resource_id': resource_id, 'poster_id': poster_id},
        )
    with op.batch_alter_table('anime_poster') as batch_op:
        batch_op.alter_column('resource_id', nullable=False)
        batch_op.create_foreign_key('fk_anime_poster_resource_id', 'anime_poster_resource', ['resource_id'], ['id'], ondelete='RESTRICT')
        batch_op.create_unique_constraint('uq_anime_poster_anime_id_resource_id', ['anime_id', 'resource_id'])
        batch_op.drop_column('last_error')
        batch_op.drop_column('status')
        batch_op.drop_column('source_url')
        batch_op.drop_column('size_bytes')
        batch_op.drop_column('mime_type')
        batch_op.drop_column('storage_path')

    if connection.dialect.name == 'postgresql':
        op.execute(
            "SELECT setval(pg_get_serial_sequence('anime_poster_resource', 'id'), "
            "COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM anime_poster_resource",
        )


def downgrade() -> None:
    with op.batch_alter_table('anime_poster') as batch_op:
        batch_op.add_column(sa.Column('storage_path', sa.String(length=512), nullable=True))
        batch_op.add_column(sa.Column('mime_type', sa.String(length=64), server_default='', nullable=False))
        batch_op.add_column(sa.Column('size_bytes', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('source_url', sa.String(length=2048), nullable=True))
        batch_op.add_column(sa.Column('status', sa.String(length=32), server_default='pending', nullable=False))
        batch_op.add_column(sa.Column('last_error', sa.String(length=1024), nullable=True))
    op.execute(
        'UPDATE anime_poster SET '
        'storage_path = (SELECT storage_path FROM anime_poster_resource WHERE id = anime_poster.resource_id), '
        'mime_type = (SELECT mime_type FROM anime_poster_resource WHERE id = anime_poster.resource_id), '
        'size_bytes = (SELECT size_bytes FROM anime_poster_resource WHERE id = anime_poster.resource_id), '
        'source_url = (SELECT source_url FROM anime_poster_resource WHERE id = anime_poster.resource_id), '
        'status = (SELECT status FROM anime_poster_resource WHERE id = anime_poster.resource_id), '
        'last_error = (SELECT last_error FROM anime_poster_resource WHERE id = anime_poster.resource_id)',
    )
    with op.batch_alter_table('anime_poster') as batch_op:
        batch_op.drop_constraint('uq_anime_poster_anime_id_resource_id', type_='unique')
        batch_op.drop_constraint('fk_anime_poster_resource_id', type_='foreignkey')
        batch_op.drop_column('priority')
        batch_op.drop_column('role')
        batch_op.drop_column('resource_id')
        batch_op.alter_column('storage_path', nullable=False)
        batch_op.create_unique_constraint('uq_anime_poster_anime_id_storage_path', ['anime_id', 'storage_path'])
    op.drop_table('anime_poster_resource')
