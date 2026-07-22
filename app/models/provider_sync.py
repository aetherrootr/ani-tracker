from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TimestampedBase


class ProviderSyncCursor(TimestampedBase):
    __tablename__ = 'provider_sync_cursor'
    __table_args__ = (
        UniqueConstraint('provider', 'stream', name='uq_provider_sync_cursor_provider_stream'),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    stream: Mapped[str] = mapped_column(String(64), nullable=False)
    cursor_timestamp: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cursor_page: Mapped[int] = mapped_column(Integer, default=0, server_default='0', nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_succeeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(1024))
