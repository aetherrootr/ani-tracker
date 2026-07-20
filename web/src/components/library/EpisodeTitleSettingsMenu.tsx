"use client";

import { CalendarClock, Settings, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
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
  onWatchTimeChange,
  onSetAllWatchTimesToAirTimes,
  canEditTitles,
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
  onWatchTimeChange: (episode: Episode, watchedAt: string) => Promise<Episode>;
  onSetAllWatchTimesToAirTimes: () => Promise<{ matchedCount: number; changedCount: number }>;
  canEditTitles: boolean;
  busy: boolean;
  onMarkTo: (episodeNumber: number) => void;
  onMarkAired: () => void;
  onClearAll: () => void;
}) {
  const t = useTranslations();
  const [dialogMode, setDialogMode] = useState<"titles" | "watchTimes" | null>(null);
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [batchPending, setBatchPending] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
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

  async function setAllWatchTimesToAirTimes() {
    setBatchPending(true);
    setBatchMessage(null);
    setBatchError(null);
    try {
      const result = await onSetAllWatchTimesToAirTimes();
      setBatchMessage(t("library.batchWatchTimesComplete", { changed: result.changedCount, matched: result.matchedCount }));
    } catch {
      setBatchError(t("library.batchWatchTimesFailed"));
    } finally {
      setBatchPending(false);
    }
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
              {canEditTitles ? (
                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => { setDialogMode("titles"); onOpenChange(false); }}>
                  {t("library.editEpisodeTitles")}
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="w-full justify-start" onClick={() => { setDialogMode("watchTimes"); onOpenChange(false); }}>
                {t("library.editEpisodeWatchTimes")}
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
      {dialogMode && typeof document !== "undefined" ? createPortal(
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-center justify-center bg-background/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
          <div className="glass-dialog flex h-[88svh] max-h-[52rem] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border text-foreground">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/65 p-5 backdrop-blur-xl dark:bg-background/65">
              <div>
                <h3 className="text-lg font-semibold">{t(dialogMode === "titles" ? "library.editEpisodeTitles" : "library.editEpisodeWatchTimes")}</h3>
                <p className="text-sm text-muted-foreground">{t("library.episodeTitlePageSummary", { page, totalPages, total })}</p>
                {dialogMode === "watchTimes" ? <p className="mt-1 text-sm text-muted-foreground">{t("library.episodeWatchTimeDescription")}</p> : null}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setDialogMode(null)}><X className="h-4 w-4" /></Button>
            </div>

            <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1 overflow-hidden" viewportClassName="h-full min-h-0 touch-pan-y space-y-3 overflow-y-auto p-5">
              {isLoading ? <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{t("app.loadingAccount")}</div> : null}
              {!isLoading && dialogMode === "watchTimes" ? (
                <div className="rounded-2xl border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{t("library.batchWatchTimesTitle")}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{t("library.batchWatchTimesDescription")}</p>
                    </div>
                    <Button type="button" className="min-h-11 shrink-0" disabled={busy || batchPending} aria-busy={batchPending} onClick={() => void setAllWatchTimesToAirTimes()}>
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      {t("library.batchWatchTimesAction")}
                    </Button>
                  </div>
                  {batchMessage ? <p className="mt-3 text-sm text-[var(--watched)]" role="status">{batchMessage}</p> : null}
                  {batchError ? <p className="mt-3 text-sm text-destructive" role="alert">{batchError}</p> : null}
                </div>
              ) : null}
              {!isLoading && dialogMode === "titles" && episodes.map((episode) => {
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
              {!isLoading && dialogMode === "watchTimes" && episodes.filter((episode) => episode.watched).map((episode) => (
                <EpisodeWatchTimeEditor key={episode.id} episode={episode} onSave={onWatchTimeChange} />
              ))}
              {!isLoading && dialogMode === "watchTimes" && !episodes.some((episode) => episode.watched) ? (
                <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{t("library.noWatchedEpisodesOnPage")}</div>
              ) : null}
            </ScrollArea>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-background/65 p-5 backdrop-blur-xl dark:bg-background/65">
              <Button type="button" variant="outline" disabled={page <= 1 || isLoading} onClick={() => onPageChange(page - 1)}>{t("library.previous")}</Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button type="button" variant="outline" disabled={page >= totalPages || isLoading} onClick={() => onPageChange(page + 1)}>{t("library.next")}</Button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function EpisodeWatchTimeEditor({ episode, onSave }: { episode: Episode; onSave: (episode: Episode, watchedAt: string) => Promise<Episode> }) {
  const t = useTranslations();
  const locale = useLocale();
  const [value, setValue] = useState(() => toLocalDateTimeValue(episode.watchedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(watchedAt: string) {
    setSaving(true);
    setError(null);
    try {
      const updated = await onSave(episode, watchedAt);
      setValue(toLocalDateTimeValue(updated.watchedAt));
    } catch {
      setError(t("library.watchTimeSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-background/60 p-3">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{episode.episodeNumber}</div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="font-medium">{episode.displayName || t("library.episodeFallbackTitle", { episode: episode.episodeNumber })}</div>
          <div className="space-y-1.5 text-sm font-medium">
            <span>{t("library.episodeWatchTime")}</span>
            <DateTimePicker
              value={value}
              locale={locale}
              disabled={saving}
              labels={{
                open: t("library.openWatchTimePicker"),
                previousMonth: t("library.previousMonth"),
                nextMonth: t("library.nextMonth"),
                date: t("library.selectWatchDate"),
                hour: t("library.hour"),
                minute: t("library.minute"),
                done: t("library.doneSelectingTime"),
              }}
              onChange={setValue}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={saving || !value} aria-busy={saving} onClick={() => void save(new Date(value).toISOString())}>
              {t("library.saveWatchTime")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={saving || !episode.airAt} title={episode.airAt ? undefined : t("library.episodeAirTimeUnavailable")} onClick={() => episode.airAt && void save(episode.airAt)}>
              {t("library.useEpisodeAirTime")}
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function toLocalDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
