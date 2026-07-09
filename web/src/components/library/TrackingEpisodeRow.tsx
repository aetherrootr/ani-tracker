"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/features/library/api";
import type { TrackingListItem } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { EpisodeWatchToggle } from "./EpisodeWatchToggle";
import { NoPoster } from "./NoPoster";
import { PosterImage } from "./PosterImage";

type Props = {
  item: TrackingListItem;
  disabled?: boolean;
  isSaving?: boolean;
  onWatchChange: (item: TrackingListItem, watched: boolean) => Promise<void>;
};

export function TrackingEpisodeRow({ item, disabled, isSaving, onWatchChange }: Props) {
  const t = useTranslations();
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = assetUrl(item.anime.posterUrl);
  const imageFailed = poster !== null && failedPoster === poster;
  const total = item.totalEpisodeCount ?? item.airedEpisodeCount;
  const progress = `${item.watchedEpisodeCount} / ${total || "?"}`;

  return (
    <EpisodeWatchToggle
      watched={item.episode.watched}
      disabled={disabled}
      label={t("library.toggleEpisode", { episode: item.episode.episodeNumber })}
      onChange={(watched) => onWatchChange(item, watched)}
    >
      {(style, backdrop, handlers, isDragging, dragState) => (
        <article className="relative overflow-hidden rounded-2xl border bg-card shadow-sm touch-pan-y">
          {backdrop}
          <div
            {...handlers}
            className={cn(
              "relative z-10 bg-card pr-16 motion-reduce:transition-none",
              isDragging ? "cursor-grabbing shadow-lg transition-none" : "cursor-grab transition-[transform,box-shadow] duration-200 ease-out",
              item.episode.watched && "bg-primary/5",
              isSaving && "bg-emerald-500/20 shadow-emerald-500/20",
              dragState.triggered && dragState.unavailable && "bg-muted shadow-muted",
              dragState.triggered && !dragState.unavailable && dragState.direction === "watched" && "bg-emerald-500/20 shadow-emerald-500/20",
              dragState.triggered && !dragState.unavailable && dragState.direction === "unwatched" && "bg-sky-500/20 shadow-sky-500/20",
            )}
            style={style}
          >
            {isSaving ? (
              <div className="absolute right-16 top-1/2 z-20 -translate-y-1/2 rounded-full bg-emerald-500 p-2 text-white shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : null}
            <div className="flex min-h-28 gap-3 p-3 sm:gap-4 sm:p-4">
              <div className="relative aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-20">
                {poster && !imageFailed ? (
                  <PosterImage
                    src={poster}
                    alt={t("anime.coverAlt", { title: item.anime.displayName })}
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

              <div className="min-w-0 flex-1 select-none space-y-2">
                <div className="min-w-0">
                  <h3 className="line-clamp-2 font-semibold leading-tight tracking-tight">
                    <Link
                      href={`/library/${item.anime.id}`}
                      className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerMove={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                    >
                      {item.anime.displayName}
                    </Link>
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">EP {item.episode.episodeNumber}</span>
                    <span className="mx-2 text-muted-foreground/60">/</span>
                    {item.episode.displayName}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{t("tracking.nextEpisode")}</Badge>
                  <span>{t("tracking.airedAt")}: {item.episode.airAt?.slice(0, 10) ?? "-"}</span>
                  <span>{t("tracking.progress")}: {progress}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      )}
    </EpisodeWatchToggle>
  );
}
