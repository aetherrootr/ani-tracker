"use client";

import { useLocale, useTranslations } from "next-intl";

import type { Episode } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { EpisodeWatchToggle } from "./EpisodeWatchToggle";

export function EpisodeRow({ episode, isNext = false, disabled, onWatchChange }: { episode: Episode; isNext?: boolean; disabled?: boolean; onWatchChange: (episode: Episode, watched: boolean) => Promise<void> }) {
  const t = useTranslations();
  const locale = useLocale();
  const displayName = episode.displayName?.trim() || episode.originalTitle?.trim() || t("library.episodeFallbackTitle", { episode: episode.episodeNumber });
  const originalTitle = episode.originalTitle?.trim();
  const showOriginal = Boolean(originalTitle && originalTitle !== displayName);
  const isUpcoming = episode.status !== "aired";
  const watchLabel = episode.watched
    ? t("library.markEpisodeUnwatched", { episode: episode.episodeNumber })
    : t("library.markEpisodeWatched", { episode: episode.episodeNumber });
  const rowLabel = t("library.episodeAccessibleLabel", {
    episode: episode.episodeNumber,
    title: displayName,
    airStatus: isUpcoming ? t("library.upcomingStatus") : t("library.airedStatus"),
    watchStatus: episode.watched ? t("library.episodeFilter.watched") : t("library.episodeFilter.unwatched"),
  });

  return (
    <EpisodeWatchToggle
      watched={episode.watched}
      requireWatchConfirm={!episode.watched && episode.status !== "aired"}
      disabled={disabled}
      label={watchLabel}
      onChange={(watched) => onWatchChange(episode, watched)}
    >
      {(style, backdrop, handlers, isDragging, dragState, watchButton) => (
        <article id={`episode-${episode.id}`} aria-label={rowLabel} className={cn(
          "relative scroll-mt-24 overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface-card)] touch-auto target:ring-2 target:ring-primary target:ring-offset-2",
          episode.watched && "border-[color-mix(in_srgb,var(--watched)_24%,transparent)] bg-[color-mix(in_srgb,var(--watched)_6%,var(--surface-card))]",
          isNext && "border-[color-mix(in_srgb,var(--accent-solid)_28%,transparent)] bg-[var(--accent-soft)] shadow-[var(--shadow-low)]",
        )}>
          {backdrop}
          <div
            {...handlers}
            className={cn(
              "relative z-10 min-h-24 select-none bg-transparent p-4 pr-16 motion-reduce:transition-none",
              isDragging ? "cursor-grabbing shadow-lg transition-none" : "cursor-grab transition-[transform,box-shadow] duration-200 ease-out",
              dragState.triggered && dragState.unavailable && "bg-muted shadow-muted",
            )}
            style={style}
          >
            {watchButton}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {episode.episodeNumber}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {isNext ? <span className="rounded-full bg-[var(--accent-solid)] px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{t("library.nextEpisodeBadge")}</span> : null}
                  {episode.watched ? <span className="rounded-full bg-[color-mix(in_srgb,var(--watched)_16%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--watched)]">{t("library.episodeFilter.watched")}</span> : null}
                  {isUpcoming && !episode.watched ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{t("library.upcomingStatus")}</span> : null}
                </div>
                <h3 className="mt-1 font-medium leading-snug">{displayName}</h3>
                {showOriginal ? <p className="mt-1 text-xs text-muted-foreground">{originalTitle}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{episode.status === "aired" ? t("library.airedStatus") : t("library.upcomingStatus")}</span>
                  <span>{formatEpisodeDate(episode.airAt, locale, t("library.episodeAirDateUnknown"))}</span>
                  {episode.duration ? <span>{episode.duration}</span> : null}
                </div>
              </div>
            </div>
          </div>
        </article>
      )}
    </EpisodeWatchToggle>
  );
}

function formatEpisodeDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
