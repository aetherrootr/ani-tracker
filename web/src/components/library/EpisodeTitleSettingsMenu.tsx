"use client";

import { Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { updateEpisodeNamePreference } from "@/features/library/api";
import type { Episode } from "@/features/library/types";

import { useAnchoredEpisodePopover } from "./use-anchored-episode-popover";

export function EpisodeTitleSettingsMenu({
  animeId,
  episodes,
  page,
  totalPages,
  total,
  isLoading,
  open,
  onOpenChange,
  onPageChange,
  onEpisodeChange,
  busy,
  onMarkTo,
  onMarkAired,
  onClearAll,
}: {
  animeId: number;
  episodes: Episode[];
  page: number;
  totalPages: number;
  total: number;
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPageChange: (page: number) => void;
  onEpisodeChange: (episode: Episode) => void;
  busy: boolean;
  onMarkTo: (episodeNumber: number) => void;
  onMarkAired: () => void;
  onClearAll: () => void;
}) {
  const t = useTranslations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { desktop, position } = useAnchoredEpisodePopover(open, triggerRef, "start");

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector("button")?.focus());
    function dismissAndRestoreFocus() {
      onOpenChange(false);
      setEpisodeNumber("");
      requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismissAndRestoreFocus();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismissAndRestoreFocus();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  async function chooseName(episode: Episode, nameId: number | null) {
    setSavingId(episode.id);
    try {
      const selectedName = nameId === null ? null : episode.availableNames.find((name) => name.id === nameId) ?? null;
      const result = await updateEpisodeNamePreference(animeId, episode.id, nameId);
      const nextName = selectedName ?? result.name;
      onEpisodeChange({
        ...episode,
        name: nextName,
        displayName: nextName?.name ?? episode.originalTitle,
        preferredNameId: result.episode.preferredNameId,
      });
    } finally {
      setSavingId(null);
    }
  }

  function closeMenu() {
    onOpenChange(false);
    setEpisodeNumber("");
    requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
  }

  return (
    <div ref={triggerRef} className="relative">
      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("library.episodeTitleSettings")} aria-expanded={open} aria-haspopup="dialog" aria-controls={panelId} onClick={() => onOpenChange(!open)}>
        <Settings className="h-4 w-4" />
      </Button>
      {open && (!desktop || position) && typeof document !== "undefined" ? createPortal(
        <div ref={panelRef} id={panelId} style={desktop ? position ?? undefined : undefined} className={`glass-dialog fixed rounded-2xl border text-foreground ${desktop ? "w-80" : "mobile-top-popover-enter inset-x-4 top-24"}`} role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`}>
          <ScrollArea ariaLabel={t("app.scrollableContent")} className={desktop ? "max-h-none" : "max-h-[min(60vh,28rem)]"} viewportClassName={`${desktop ? "max-h-none overflow-visible" : "max-h-[min(60vh,28rem)]"} p-4`}>
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${panelId}-title`} className="font-semibold">{t("library.episodeSettingsMenuTitle")}</h3>
              <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("library.closeFilters")} onClick={closeMenu}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => { setDialogOpen(true); onOpenChange(false); }}>
                {t("library.editEpisodeTitles")}
              </Button>
              <div className="flex gap-2 border-t pt-3">
                <Input value={episodeNumber} inputMode="numeric" placeholder={t("library.episodeNumber")} onChange={(event) => setEpisodeNumber(event.target.value)} />
                <Button type="button" disabled={busy || !/^\d+$/.test(episodeNumber) || Number(episodeNumber) < 1} aria-busy={busy} onClick={() => onMarkTo(Number(episodeNumber))}>{t("library.markToEpisode")}</Button>
              </div>
              <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={onMarkAired}>{t("library.markAllAired")}</Button>
              <Button type="button" variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10" disabled={busy} onClick={onClearAll}>{t("library.clearAllWatched")}</Button>
            </div>
          </ScrollArea>
        </div>,
        document.body,
      ) : null}
      {dialogOpen ? (
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 backdrop-blur-sm md:items-center" role="dialog" aria-modal="true">
          <div className="glass-dialog flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border text-foreground md:max-h-[86vh]">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/65 p-5 backdrop-blur-xl dark:bg-background/65">
              <div>
                <h3 className="text-lg font-semibold">{t("library.editEpisodeTitles")}</h3>
                <p className="text-sm text-muted-foreground">{t("library.episodeTitlePageSummary", { page, totalPages, total })}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setDialogOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1" viewportClassName="h-full space-y-3 p-5">
              {isLoading ? <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{t("app.loadingAccount")}</div> : null}
              {!isLoading && episodes.map((episode) => {
                const availableNames = uniqueEpisodeNames(episode);
                return (
                  <div key={episode.id} className="rounded-xl border bg-background/60 p-3">
                    <div className="flex gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{episode.episodeNumber}</div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <div className="font-medium">{episode.displayName}</div>
                          {episode.originalTitle !== episode.displayName ? <div className="text-xs text-muted-foreground">{episode.originalTitle}</div> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant={episode.preferredNameId === null ? "default" : "outline"} className="h-auto min-h-10 max-w-full whitespace-normal break-words px-3 py-2 text-left leading-snug" disabled={savingId === episode.id} onClick={() => void chooseName(episode, null)}>
                            {episode.originalTitle}
                          </Button>
                          {availableNames.map((name) => (
                            <Button key={name.id} type="button" size="sm" variant={episode.preferredNameId === name.id ? "default" : "outline"} className="h-auto min-h-10 max-w-full whitespace-normal break-words px-3 py-2 text-left leading-snug" disabled={savingId === episode.id} onClick={() => void chooseName(episode, name.id)}>
                              {name.name}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </ScrollArea>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-background/65 p-5 backdrop-blur-xl dark:bg-background/65">
              <Button type="button" variant="outline" disabled={page <= 1 || isLoading} onClick={() => onPageChange(page - 1)}>{t("library.previous")}</Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button type="button" variant="outline" disabled={page >= totalPages || isLoading} onClick={() => onPageChange(page + 1)}>{t("library.next")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function uniqueEpisodeNames(episode: Episode) {
  const seen = new Set([normalizeTitle(episode.originalTitle)]);
  return episode.availableNames.filter((name) => {
    const key = normalizeTitle(name.name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeTitle(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
