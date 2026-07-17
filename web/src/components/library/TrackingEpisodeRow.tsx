"use client";

import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Check, ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { assetUrl } from "@/features/library/api";
import type { TrackingListItem } from "@/features/library/types";
import { useLocaleControls } from "@/i18n/provider";

import { EpisodeTicket } from "./EpisodeTicket";

type Props = {
  item: TrackingListItem;
  disabled?: boolean;
  isSaving?: boolean;
  showProgress?: boolean;
  compact?: boolean;
  variant?: "queue" | "recent";
  onWatchChange: (item: TrackingListItem, watched: boolean) => Promise<void>;
};

export function TrackingEpisodeRow({ item, disabled, isSaving, showProgress = true, compact = false, variant = "queue", onWatchChange }: Props) {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = assetUrl(item.anime.posterUrl);
  const showPoster = poster !== null && failedPoster !== poster;
  const total = item.totalEpisodeCount ?? item.airedEpisodeCount;
  const progress = `${item.watchedEpisodeCount} / ${total || "?"}`;
  const episodeTitle = item.episode.displayName?.trim() || t("library.episodeFallbackTitle", { episode: item.episode.episodeNumber });
  const watched = item.episode.watched;

  return (
    <EpisodeTicket
      watched={watched}
      disabled={disabled || isSaving}
      density={compact ? (variant === "recent" ? "recent" : "compact") : "standard"}
      label={t("library.trackingEpisodeWatchStateLabel", {
        anime: item.anime.displayName,
        episode: item.episode.episodeNumber,
      })}
      accessibleLabel={t("library.trackingEpisodeAccessibleLabel", {
        anime: item.anime.displayName,
        episode: item.episode.episodeNumber,
        title: episodeTitle,
        watchStatus: watched ? t("tracking.watched") : t("library.unwatched"),
      })}
      onChange={(next) => onWatchChange(item, next)}
    >
      <div className="tracking-ticket-content">
        <div className="tracking-ticket-poster" aria-hidden="true">
          {showPoster ? (
            <Image
              src={poster}
              alt=""
              fill
              unoptimized
              draggable={false}
              sizes={compact ? "48px" : "56px"}
              className="object-cover"
              onError={() => setFailedPoster(poster)}
            />
          ) : (
            <ImageOff aria-hidden="true" />
          )}
        </div>

        <div className="tracking-ticket-copy">
          <h3>
            <Link href={`/library/${item.anime.id}`} data-ticket-interactive>
              {item.anime.displayName}
            </Link>
          </h3>
          <p className="tracking-ticket-episode-title">{episodeTitle}</p>
          <div className="episode-ticket-badges">
            <span className="episode-badge episode-badge-number">{t("library.episodeShort")} {item.episode.episodeNumber}</span>
            {variant === "queue" ? (
              <span className="episode-badge episode-badge-next">{t("tracking.nextEpisode")}</span>
            ) : (
              <span className="episode-badge episode-badge-watched"><Check aria-hidden="true" />{t("tracking.watched")}</span>
            )}
            {showProgress ? <span className="episode-progress">{progress}</span> : null}
          </div>
          <p className="tracking-ticket-date">
            <CalendarDays aria-hidden="true" />
            {variant === "recent"
              ? formatWatchedTime(item.episode.watchedAt, locale, t("tracking.watchedTimeUnknown"))
              : `${t("tracking.airedAt")}: ${formatDate(item.episode.airAt, locale)}`}
          </p>
        </div>
      </div>
    </EpisodeTicket>
  );
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatWatchedTime(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}
