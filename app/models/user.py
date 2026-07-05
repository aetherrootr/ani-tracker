from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase

if TYPE_CHECKING:
    from app.models.progress import UserAnimeProgress, UserEpisodeProgress

DEFAULT_LANGUAGE_PREFERENCE = "zh-CN"


class User(TimestampedBase):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    language_preference: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default=DEFAULT_LANGUAGE_PREFERENCE,
    )

    episode_progresses: Mapped[list[UserEpisodeProgress]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    anime_progresses: Mapped[list[UserAnimeProgress]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
