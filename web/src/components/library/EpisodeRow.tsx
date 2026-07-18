"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Episode } from "@/features/library/types";
import { formatEpisodeAirAt } from "@/features/library/format-episode-air-at";

import { EpisodeTicket } from "./EpisodeTicket";

type Props = {
  episode: Episode;
  isNext?: boolean;
  disabled?: boolean;
  onWatchChange: (episode: Episode, watched: boolean) => Promise<void>;
};

export function EpisodeRow({ episode, isNext = false, disabled, onWatchChange }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const title = episode.displayName?.trim() || episode.originalTitle?.trim() || t("library.episodeFallbackTitle", { episode: episode.episodeNumber });
  const originalTitle = episode.originalTitle?.trim();
  const upcoming = episode.status !== "aired";
  const stateText = episode.watched ? t("library.episodeFilter.watched") : upcoming ? t("library.upcomingStatus") : t("library.unwatched");
  const accessibleLabel = t("library.episodeAccessibleLabel", {
    episode: episode.episodeNumber,
    title,
    airStatus: upcoming ? t("library.upcomingStatus") : t("library.airedStatus"),
    watchStatus: stateText,
  });

  return (
    <EpisodeTicket
      id={`episode-${episode.id}`}
      watched={episode.watched}
      disabled={disabled}
      requireWatchConfirm={!episode.watched && upcoming}
      label={t("library.episodeWatchStateLabel", { episode: episode.episodeNumber })}
      accessibleLabel={accessibleLabel}
      onChange={(watched) => onWatchChange(episode, watched)}
    >
      <div className="episode-detail-content">
        <div className="episode-number" aria-hidden="true">
          <span>{t("library.episodeShort")}</span>
          <strong>{episode.episodeNumber}</strong>
        </div>
        <div className="episode-copy">
          <div className="episode-ticket-badges">
            {isNext ? <span className="episode-badge episode-badge-next">{t("library.nextEpisodeBadge")}</span> : null}
            {episode.watched ? <span className="episode-badge episode-badge-watched"><span aria-hidden="true">✓</span>{t("library.episodeFilter.watched")}</span> : null}
            {upcoming && !episode.watched ? <span className="episode-badge">{t("library.upcomingStatus")}</span> : null}
          </div>
          <h3>{title}</h3>
          {originalTitle && originalTitle !== title ? <p className="episode-original-title">{originalTitle}</p> : null}
          <div className="episode-ticket-metadata">
            <span><CalendarDays aria-hidden="true" />{formatEpisodeAirAt(episode.airAt, episode.airAtPrecision, locale, t("library.episodeAirDateUnknown"))}</span>
            {episode.duration ? <span><Clock3 aria-hidden="true" />{episode.duration}</span> : null}
          </div>
        </div>
      </div>
    </EpisodeTicket>
  );
}
