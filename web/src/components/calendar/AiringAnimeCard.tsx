"use client";

import { Check, Clock3 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { NoPoster } from "@/components/library/NoPoster";
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
  const timeSummary = formatTimeSummary(item, locale, timeZone, t);
  const watchedSummary = item.watchedEpisodeCount === item.episodeCount
    ? t("calendar.watched")
    : item.watchedEpisodeCount > 0
      ? t("calendar.watchedPartial", { watched: item.watchedEpisodeCount, total: item.episodeCount })
      : null;
  const accessibleName = [item.anime.displayName, summary, item.minimumEpisodeTitle, dateLabel, timeSummary]
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
      </div>
      {timeSummary || watchedSummary ? (
        <div className="daily-airing-card-trailing">
          {timeSummary ? (
            <span className="daily-airing-card-time"><Clock3 aria-hidden="true" />{timeSummary}</span>
          ) : null}
          {watchedSummary ? (
            <span className="daily-airing-card-watched"><Check aria-hidden="true" />{watchedSummary}</span>
          ) : null}
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
  const timeSummary = formatTimeSummary(item, locale, timeZone, t);
  const watchedSummary = item.watchedEpisodeCount === item.episodeCount
    ? t("calendar.watched")
    : item.watchedEpisodeCount > 0
      ? t("calendar.watchedPartial", { watched: item.watchedEpisodeCount, total: item.episodeCount })
      : null;
  const accessibleName = [item.anime.displayName, summary, item.minimumEpisodeTitle, dateLabel, timeSummary]
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
        {timeSummary || watchedSummary ? (
          <div className="mobile-airing-card-meta">
            {timeSummary ? <span><Clock3 aria-hidden="true" />{timeSummary}</span> : null}
            {watchedSummary ? <span className="mobile-airing-card-watched"><Check aria-hidden="true" />{watchedSummary}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function formatTimeSummary(
  item: AiringCalendarItem,
  locale: string,
  timeZone: string,
  t: ReturnType<typeof useTranslations>,
) {
  const { earliestExactAirAt, exactTimeSlotCount, hasDatePrecision } = item.scheduleSummary;
  if (!earliestExactAirAt) return hasDatePrecision ? null : null;
  const time = formatExactTime(earliestExactAirAt, locale, timeZone);
  const exact = exactTimeSlotCount > 1
    ? t("calendar.multipleTimes", { time, count: exactTimeSlotCount })
    : t("calendar.exactTime", { time });
  return hasDatePrecision ? `${exact} · ${t("calendar.someTimesUnknown")}` : exact;
}

function formatExactTime(value: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
