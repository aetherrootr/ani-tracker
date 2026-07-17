"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/features/library/api";
import type { TrackingListItem } from "@/features/library/types";
import { useLocaleControls } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { EpisodeWatchToggle } from "./EpisodeWatchToggle";
import { NoPoster } from "./NoPoster";

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
  const imageFailed = poster !== null && failedPoster === poster;
  const total = item.totalEpisodeCount ?? item.airedEpisodeCount;
  const progress = `${item.watchedEpisodeCount} / ${total || "?"}`;

  return (
    <EpisodeWatchToggle
      watched={item.episode.watched}
      disabled={disabled}
      buttonClassName={compact ? "desktop-compact-watch-button right-3" : undefined}
      label={t("library.toggleEpisode", { episode: item.episode.episodeNumber })}
      onChange={(watched) => onWatchChange(item, watched)}
    >
      {(style, backdrop, handlers, isDragging, dragState, watchButton) => (
        <article className={cn("episode-card-shadow interactive-card relative rounded-[var(--radius-card)]", compact && "rounded-[18px]") }>
          <div className="drag-action-surface relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-neutral)]">
            {compact && variant === "recent" ? <div className="pointer-events-none absolute bottom-4 left-0 top-4 z-[1] w-[3px] rounded-r-full bg-[var(--watched)]" aria-hidden="true" /> : null}
            {backdrop}
          <div
            {...handlers}
            className={cn(
              "relative z-10 bg-[var(--surface-card)] pr-16 motion-reduce:transition-none",
              isDragging ? "cursor-grabbing shadow-[var(--shadow-medium)] transition-none" : "cursor-grab transition-[transform,box-shadow] duration-200 ease-[var(--ease-standard)]",
               item.episode.watched && !compact && "bg-[color-mix(in_srgb,var(--watched)_8%,var(--surface-card))]",
               isSaving && "bg-[color-mix(in_srgb,var(--text-secondary)_6%,var(--surface-card))]",
              dragState.triggered && dragState.unavailable && "bg-muted",
            )}
            style={style}
          >
             {isSaving ? (
               <div className="absolute right-16 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-[var(--surface-solid)] px-2.5 py-2 text-xs font-medium text-muted-foreground shadow-[var(--shadow-low)]" role="status">
                 <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                 <span className="sr-only sm:not-sr-only">{t("tracking.updating")}</span>
               </div>
            ) : null}
            <div className={cn(
              "flex min-h-28 gap-3 p-3 sm:gap-4 sm:p-4",
              compact && "min-h-[136px] gap-[14px] p-3 pr-14 sm:gap-[14px] sm:p-3 sm:pr-14",
              compact && variant === "recent" && "min-h-[108px] gap-3 p-2.5 pr-12 sm:gap-3 sm:p-2.5 sm:pr-12",
            )}>
              <div className={cn("relative aspect-[2/3] w-16 shrink-0 self-start overflow-hidden rounded-[var(--radius-control)] bg-muted sm:w-20", compact && "w-20 rounded-xl sm:w-20", compact && variant === "recent" && "w-16 sm:w-16")}>
                {poster && !imageFailed ? (
                  <Image
                    key={poster}
                    src={poster}
                    alt={t("anime.coverAlt", { title: item.anime.displayName })}
                    fill
                    unoptimized
                    sizes="(min-width: 640px) 80px, 64px"
                    className="object-cover opacity-0 transition-opacity duration-300 motion-reduce:transition-none"
                    draggable={false}
                    onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
                    onError={() => setFailedPoster(poster)}
                  />
                ) : (
                  <NoPoster />
                )}
              </div>

              <div className={cn("min-w-0 flex-1 select-none space-y-3", compact && "space-y-2", compact && variant === "recent" && "space-y-1.5") }>
                <div className="min-w-0 space-y-1.5">
                  <h3 className={cn("line-clamp-2 text-[0.98rem] font-semibold leading-tight tracking-tight text-foreground", compact && "text-[15px] leading-[1.3]", compact && variant === "recent" && "text-sm") }>
                    <Link
                      href={`/library/${item.anime.id}`}
                      className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerMove={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                    >
                      {item.anime.displayName}
                    </Link>
                  </h3>
                  <p className={cn("line-clamp-2 text-sm leading-5 text-muted-foreground", compact && "line-clamp-1", compact && variant === "recent" && "text-xs leading-4")}>{item.episode.displayName}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                   <Badge variant="secondary" className={variant === "queue" ? "bg-[var(--accent-soft)] text-foreground" : undefined}>EP {item.episode.episodeNumber}</Badge>
                   {variant === "queue" ? (
                     <Badge variant="secondary">{t("tracking.nextEpisode")}</Badge>
                   ) : (
                     <Badge variant="secondary" className="gap-1 whitespace-nowrap bg-[color-mix(in_srgb,var(--watched)_12%,var(--surface-card))] text-foreground">
                       <Check className="h-3 w-3 text-[var(--watched)]" aria-hidden="true" />
                       {t("tracking.watched")}
                     </Badge>
                   )}
                  {showProgress ? <span className="rounded-full bg-[var(--surface-glass-subtle)] px-2.5 py-1 font-medium text-foreground">{progress}</span> : null}
                </div>
                <p className="whitespace-nowrap text-xs text-[var(--text-tertiary)]">
                   {variant === "recent"
                     ? formatWatchedTime(item.episode.watchedAt, locale, t("tracking.watchedTimeUnknown"))
                     : `${t("tracking.airedAt")}: ${formatDate(item.episode.airAt, locale)}`}
                 </p>
               </div>
             </div>
             {watchButton}
           </div>
          </div>
        </article>
      )}
    </EpisodeWatchToggle>
  );
}

function formatDate(value: string | null, locale: string) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatWatchedTime(value: string | null, locale: string, fallback: string) {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}
