"use client";

import { Check, Clock3 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { NoPoster } from "@/components/library/NoPoster";
import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/features/library/api";
import { formatEpisodeSummary } from "@/features/calendar/format-episode-ranges";
import type { AiringCalendarItem } from "@/features/calendar/types";
import { useLocaleControls } from "@/i18n/provider";

type AiringAnimeCardProps = {
  item: AiringCalendarItem;
  dateLabel: string;
  timeZone: string;
};

export function AiringAnimeCard({
  item,
  dateLabel,
  timeZone,
}: AiringAnimeCardProps) {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const summary = formatEpisodeSummary(
    item.episodes.map((episode) => episode.episodeNumber),
    item.episodeCount,
    {
      single: (episode) => t("calendar.episodeSingle", { episode }),
      range: (start, end) => t("calendar.episodeRange", { start, end }),
      more: (range, count) => t("calendar.episodeMore", { range, count }),
      fallback: (count) => t("calendar.episodeFallback", { count }),
    },
  );
  const episodeTime = formatEpisodeTime(item, locale, timeZone);
  const watchedEpisodeCount = getWatchedEpisodeCount(item);
  const isWatched = watchedEpisodeCount === item.episodeCount;
  const watchedSummary = isWatched
    ? t("calendar.watched")
    : watchedEpisodeCount > 0
      ? t("calendar.watchedPartial", { watched: watchedEpisodeCount, total: item.episodeCount })
      : null;
  const airingStatus = getAiringStatus(item);
  const airingStatusLabel = t(`library.${airingStatus}Status`);
  const accessibleName = [
    item.anime.displayName,
    airingStatusLabel,
    summary,
    item.minimumEpisodeTitle,
    dateLabel,
    episodeTime?.label,
    watchedSummary,
  ]
    .filter(Boolean)
    .join(", ");
  const posterUrl = assetUrl(item.anime.posterUrl);

  return (
    <article className="daily-airing-card app-content-card">
      <Link
        href={`/library/${item.anime.id}`}
        className="daily-airing-card-link"
        aria-label={accessibleName}
      />
      <div className="daily-airing-card-poster" aria-hidden="true">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt=""
            fill
            unoptimized
            sizes="96px"
            className="object-cover"
          />
        ) : <NoPoster />}
      </div>
      <div className="daily-airing-card-body">
        <h3 className="daily-airing-card-title">{item.anime.displayName}</h3>
        <p className="daily-airing-card-episode">
          <span>{summary}</span>
          {item.minimumEpisodeTitle ? <span>{item.minimumEpisodeTitle}</span> : null}
        </p>
        <div className="airing-card-meta">
          <AiringStatusBadge status={airingStatus} label={airingStatusLabel} muted={isWatched} />
          {episodeTime ? (
            <span className="airing-card-update-time">
              <Clock3 aria-hidden="true" />
              <time dateTime={episodeTime.airAt}>{episodeTime.label}</time>
            </span>
          ) : null}
        </div>
      </div>
      {watchedSummary ? (
        <div className="daily-airing-card-trailing">
          <span className="daily-airing-card-watched"><Check aria-hidden="true" />{watchedSummary}</span>
        </div>
      ) : null}
    </article>
  );
}

export function MobileAiringAnimeCard({
  item,
  dateLabel,
  timeZone,
}: AiringAnimeCardProps) {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const summary = formatEpisodeSummary(
    item.episodes.map((episode) => episode.episodeNumber),
    item.episodeCount,
    {
      single: (episode) => t("calendar.episodeSingle", { episode }),
      range: (start, end) => t("calendar.episodeRange", { start, end }),
      more: (range, count) => t("calendar.episodeMore", { range, count }),
      fallback: (count) => t("calendar.episodeFallback", { count }),
    },
  );
  const episodeTime = formatEpisodeTime(item, locale, timeZone);
  const watchedEpisodeCount = getWatchedEpisodeCount(item);
  const isWatched = watchedEpisodeCount === item.episodeCount;
  const watchedSummary = isWatched
    ? t("calendar.watched")
    : watchedEpisodeCount > 0
      ? t("calendar.watchedPartial", { watched: watchedEpisodeCount, total: item.episodeCount })
      : null;
  const airingStatus = getAiringStatus(item);
  const airingStatusLabel = t(`library.${airingStatus}Status`);
  const accessibleName = [
    item.anime.displayName,
    airingStatusLabel,
    summary,
    item.minimumEpisodeTitle,
    dateLabel,
    episodeTime?.label,
    watchedSummary,
  ]
    .filter(Boolean)
    .join(", ");
  const posterUrl = assetUrl(item.anime.posterUrl);

  return (
    <article className="mobile-airing-card app-content-card">
      <Link href={`/library/${item.anime.id}`} className="mobile-airing-card-link" aria-label={accessibleName} />
      <div className="mobile-airing-card-poster" aria-hidden="true">
        {posterUrl ? (
          <Image src={posterUrl} alt="" fill unoptimized sizes="72px" className="object-cover" />
        ) : <NoPoster />}
      </div>
      <div className="mobile-airing-card-body">
        <h3>{item.anime.displayName}</h3>
        <p className="mobile-airing-card-episode">{summary}</p>
        {item.minimumEpisodeTitle ? <p className="mobile-airing-card-episode-title">{item.minimumEpisodeTitle}</p> : null}
        <div className="airing-card-meta">
          <AiringStatusBadge status={airingStatus} label={airingStatusLabel} muted={isWatched} />
          {episodeTime ? (
            <span className="airing-card-update-time">
              <Clock3 aria-hidden="true" />
              <time dateTime={episodeTime.airAt}>{episodeTime.label}</time>
            </span>
          ) : null}
        </div>
      </div>
      {watchedSummary ? (
        <span className="mobile-airing-card-watched"><Check aria-hidden="true" />{watchedSummary}</span>
      ) : null}
    </article>
  );
}

function formatEpisodeTime(
  item: AiringCalendarItem,
  locale: string,
  timeZone: string,
) {
  const episode = item.episodes.reduce((earliest, candidate) => (
    candidate.id < earliest.id ? candidate : earliest
  ));
  if (episode.airAtPrecision !== "datetime") return null;
  return {
    airAt: episode.airAt,
    label: formatExactTime(episode.airAt, locale, timeZone),
  };
}

function getWatchedEpisodeCount(item: AiringCalendarItem) {
  const visibleWatchedCount = item.episodes.filter((episode) => episode.watched).length;
  return Math.max(item.watchedEpisodeCount, visibleWatchedCount);
}

function getAiringStatus(item: AiringCalendarItem): "aired" | "upcoming" {
  return item.episodes.every((episode) => episode.status === "aired") ? "aired" : "upcoming";
}

function AiringStatusBadge({
  status,
  label,
  muted,
}: {
  status: "aired" | "upcoming";
  label: string;
  muted: boolean;
}) {
  return (
    <Badge
      className="airing-card-status"
      data-tone={muted ? "muted" : status}
      variant={muted ? "secondary" : status === "aired" ? "success" : "warning"}
    >
      {label}
    </Badge>
  );
}

function formatExactTime(value: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
