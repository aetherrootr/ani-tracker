from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TimestampedBase

if TYPE_CHECKING:
    from app.models.progress import UserAnimeProgress, UserEpisodeProgress

DEFAULT_LANGUAGE_PREFERENCE = "zh-CN"
DEFAULT_IMPORT_PROVIDER_PREFERENCE = "bangumi"


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
    week_start_day: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    import_provider_preference: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default=DEFAULT_IMPORT_PROVIDER_PREFERENCE,
        server_default=DEFAULT_IMPORT_PROVIDER_PREFERENCE,
    )
    include_unwatched_season_zero_in_tracking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    include_unwatched_season_zero_in_statistics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

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
    oidc_identities: Mapped[list[UserOidcIdentity]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class UserOidcIdentity(TimestampedBase):
    __tablename__ = "user_oidc_identities"
    __table_args__ = (
        UniqueConstraint("issuer", "subject", name="uq_user_oidc_identities_issuer_subject"),
        UniqueConstraint("user_id", "issuer", name="uq_user_oidc_identities_user_issuer"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    issuer: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    preferred_username: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(back_populates="oidc_identities")
