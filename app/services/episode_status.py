from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.anime import Episode, EpisodeStatus


def refresh_effective_episode_statuses(session: Session, *, now: datetime | None = None) -> int:
    effective_now = now or datetime.now(UTC)
    result = session.execute(
        update(Episode)
        .where(
            Episode.status == EpisodeStatus.UPCOMING,
            Episode.status_air_at.is_not(None),
            Episode.status_air_at <= effective_now,
        )
        .values(status=EpisodeStatus.AIRED),
        execution_options={'synchronize_session': 'fetch'},
    )
    return getattr(result, 'rowcount', 0) or 0
