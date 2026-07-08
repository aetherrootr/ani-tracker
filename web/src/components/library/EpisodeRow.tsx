"use client";

import { useTranslations } from "next-intl";

import type { Episode } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { EpisodeWatchToggle } from "./EpisodeWatchToggle";

export function EpisodeRow({ episode, disabled, onWatchChange }: { episode: Episode; disabled?: boolean; onWatchChange: (episode: Episode, watched: boolean) => Promise<void> }) {
  const t = useTranslations();
  const showOriginal = episode.originalTitle && episode.originalTitle !== episode.displayName;

  return (
    <EpisodeWatchToggle
      watched={episode.watched}
      requireWatchConfirm={!episode.watched && episode.status !== "aired"}
      disabled={disabled}
      label={t("library.toggleEpisode", { episode: episode.episodeNumber })}
      onChange={(watched) => onWatchChange(episode, watched)}
    >
      {(style, backdrop, handlers, isDragging, dragState) => (
        <div className="relative overflow-hidden rounded-2xl border bg-card touch-pan-y">
          {backdrop}
          <div
            {...handlers}
            className={cn(
              "relative z-10 min-h-24 select-none bg-card p-4 pr-16 motion-reduce:transition-none",
              isDragging ? "cursor-grabbing shadow-lg transition-none" : "cursor-grab transition-[transform,box-shadow] duration-200 ease-out",
              episode.watched && "bg-primary/5",
              dragState.triggered && dragState.direction === "watched" && "bg-emerald-500/20 shadow-emerald-500/20",
              dragState.triggered && dragState.direction === "unwatched" && "bg-sky-500/20 shadow-sky-500/20",
            )}
            style={style}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {episode.episodeNumber}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-medium leading-snug">{episode.displayName}</h3>
                {showOriginal ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{episode.originalTitle}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{episode.status}</span>
                  <span>{episode.airAt?.slice(0, 10) ?? "-"}</span>
                  <span>{episode.duration ?? "-"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </EpisodeWatchToggle>
  );
}
