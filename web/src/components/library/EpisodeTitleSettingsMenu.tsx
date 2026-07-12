"use client";

import { Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateEpisodeNamePreference } from "@/features/library/api";
import type { Episode } from "@/features/library/types";

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
  onMarkTo: (episodeNumber: number) => void;
  onMarkAired: () => void;
  onClearAll: () => void;
}) {
  const t = useTranslations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  async function chooseName(episode: Episode, nameId: number | null) {
    setSavingId(episode.id);
    const selectedName = nameId === null ? null : episode.availableNames.find((name) => name.id === nameId) ?? null;
    const result = await updateEpisodeNamePreference(animeId, episode.id, nameId);
    const nextName = selectedName ?? result.name;
    onEpisodeChange({
      ...episode,
      name: nextName,
      displayName: nextName?.name ?? episode.originalTitle,
      preferredNameId: result.episode.preferredNameId,
    });
    setSavingId(null);
  }

  function closeMenu() {
    onOpenChange(false);
    setEpisodeNumber("");
  }

  return (
    <div className="relative">
      <Button type="button" variant="ghost" size="icon" aria-label={t("library.episodeTitleSettings")} onClick={() => onOpenChange(!open)}>
        <Settings className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="glass-dialog mobile-top-popover-enter fixed inset-x-4 top-24 z-50 max-h-[min(60vh,28rem)] overflow-y-auto rounded-2xl border p-4 text-foreground md:absolute md:inset-auto md:left-0 md:top-11 md:z-30 md:max-h-none md:w-80 md:overflow-visible md:animate-none">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">{t("library.episodeSettingsMenuTitle")}</h3>
            <Button type="button" variant="ghost" size="icon" aria-label={t("library.closeFilters")} onClick={closeMenu}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => { setDialogOpen(true); onOpenChange(false); }}>
              {t("library.editEpisodeTitles")}
            </Button>
            <div className="flex gap-2 border-t pt-3">
              <Input value={episodeNumber} inputMode="numeric" placeholder={t("library.episodeNumber")} onChange={(event) => setEpisodeNumber(event.target.value)} />
              <Button type="button" onClick={() => onMarkTo(Number(episodeNumber))}>{t("library.markToEpisode")}</Button>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={onMarkAired}>{t("library.markAllAired")}</Button>
            <Button type="button" variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10" onClick={onClearAll}>{t("library.clearAllWatched")}</Button>
          </div>
        </div>
      ) : null}
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 px-4 pb-4 pt-[7.5rem] backdrop-blur-sm md:items-center md:p-4" role="dialog" aria-modal="true">
          <div className="glass-dialog flex max-h-[calc(100dvh-8rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border text-foreground md:max-h-[86vh]">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/65 p-5 backdrop-blur-xl dark:bg-background/65">
              <div>
                <h3 className="text-lg font-semibold">{t("library.editEpisodeTitles")}</h3>
                <p className="text-sm text-muted-foreground">{t("library.episodeTitlePageSummary", { page, totalPages, total })}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setDialogOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
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
            </div>

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
