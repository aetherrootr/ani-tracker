"use client";

import { CalendarDays, Clock3, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { Episode } from "@/features/library/types";
import { formatEpisodeAirAt } from "@/features/library/format-episode-air-at";
import { Button } from "@/components/ui/button";
import { ModalSurface } from "@/components/ui/modal-surface";

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
  const [titleDetailsOpen, setTitleDetailsOpen] = useState(false);
  const titleDetailsId = useId();
  const titlePointerTypeRef = useRef("");
  const upcoming = episode.status !== "aired";
  const stateText = episode.watched ? t("library.episodeFilter.watched") : upcoming ? t("library.upcomingStatus") : t("library.unwatched");
  const accessibleLabel = t("library.episodeAccessibleLabel", {
    episode: episode.episodeNumber,
    title,
    airStatus: upcoming ? t("library.upcomingStatus") : t("library.airedStatus"),
    watchStatus: stateText,
  });

  return (
    <>
      <EpisodeTicket
        className="episode-row-ticket"
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
            <h3 className="episode-title">
              <button
                type="button"
                className="episode-title-trigger"
                data-ticket-drag-surface
                aria-label={t("library.viewFullEpisodeTitle", { episode: episode.episodeNumber, title })}
                onPointerDown={(event) => {
                  titlePointerTypeRef.current = event.pointerType;
                }}
                onClick={(event) => {
                  if (!clickedOutsideRenderedTitle(event, titlePointerTypeRef.current)) setTitleDetailsOpen(true);
                }}
              >
                <span className="episode-title-text"><span className="episode-title-label">{title}</span></span>
              </button>
            </h3>
            {originalTitle && originalTitle !== title ? <span className="episode-original-title">{originalTitle}</span> : null}
            <div className="episode-ticket-metadata">
              <span><CalendarDays aria-hidden="true" />{formatEpisodeAirAt(episode.airAt, episode.airAtPrecision, locale, t("library.episodeAirDateUnknown"))}</span>
              {episode.duration ? <span><Clock3 aria-hidden="true" />{episode.duration}</span> : null}
            </div>
          </div>
        </div>
      </EpisodeTicket>
      <ModalSurface
        open={titleDetailsOpen}
        titleId={titleDetailsId}
        panelClassName="mt-auto max-h-[min(70svh,30rem)] rounded-t-[var(--radius-modal)] pb-[env(safe-area-inset-bottom)] sm:my-auto sm:max-w-lg sm:rounded-[var(--radius-modal)]"
        onClose={() => setTitleDetailsOpen(false)}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--divider)] px-5 py-3">
          <h2 id={titleDetailsId} className="text-base font-semibold">{t("library.episodeTitleDetails", { episode: episode.episodeNumber })}</h2>
          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0 rounded-full" data-dialog-close aria-label={t("library.closeEpisodeTitleDetails")} onClick={() => setTitleDetailsOpen(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-5">
          <p className="text-base font-semibold leading-relaxed text-foreground">{title}</p>
          {originalTitle && originalTitle !== title ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{originalTitle}</p> : null}
        </div>
      </ModalSurface>
    </>
  );
}

function clickedOutsideRenderedTitle(event: ReactMouseEvent<HTMLButtonElement>, pointerType: string) {
  if (event.detail === 0 || pointerType !== "mouse") return false;
  const title = event.currentTarget.querySelector(".episode-title-label");
  if (!title) return false;
  const range = document.createRange();
  range.selectNodeContents(title);
  return !Array.from(range.getClientRects()).some((rect) => (
    event.clientX >= rect.left - 2
    && event.clientX <= rect.right + 2
    && event.clientY >= rect.top - 2
    && event.clientY <= rect.bottom + 2
  ));
}
