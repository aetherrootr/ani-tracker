"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { EpisodeConflict } from "@/features/library/types";

type Props = {
  open: boolean;
  conflicts: EpisodeConflict[];
  isResolving?: boolean;
  onCancel: () => void;
  onConfirm: (deleteEpisodeIds: number[]) => void;
};

export function EpisodeConflictDialog({ open, conflicts, isResolving, onCancel, onConfirm }: Props) {
  const t = useTranslations();
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());

  if (!open) {
    return null;
  }

  function setAll(deleteAll: boolean) {
    setDeleteIds(deleteAll ? new Set(conflicts.map((conflict) => conflict.episodeId)) : new Set());
  }

  function toggleDelete(episodeId: number) {
    setDeleteIds((current) => {
      const next = new Set(current);
      if (next.has(episodeId)) {
        next.delete(episodeId);
      } else {
        next.add(episodeId);
      }
      return next;
    });
  }

  const deleteCount = deleteIds.size;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="episode-conflict-title">
      <div className="flex max-h-[90svh] w-full max-w-2xl flex-col rounded-2xl border bg-background/95 text-foreground shadow-2xl backdrop-blur-xl dark:bg-background/90">
        <div className="border-b p-5">
          <h2 id="episode-conflict-title" className="text-lg font-semibold tracking-tight">{t("library.episodeConflictsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("library.episodeConflictsDescription")}</p>
        </div>

        <div className="flex flex-wrap gap-2 border-b p-3">
          <Button type="button" size="sm" variant="outline" disabled={isResolving} onClick={() => setAll(false)}>{t("library.keepAllConflicts")}</Button>
          <Button type="button" size="sm" className="bg-destructive text-white hover:bg-destructive/90" disabled={isResolving} onClick={() => setAll(true)}>{t("library.deleteAllConflicts")}</Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {conflicts.map((conflict) => {
            const shouldDelete = deleteIds.has(conflict.episodeId);
            return (
              <div key={conflict.episodeId} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{t("library.conflictEpisode", { episode: conflict.episodeNumber })}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{conflict.displayName || t("anime.unknown")}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("library.conflictWatchedInfo", { count: conflict.watchedUserCount ?? 0 })}
                      {conflict.watchedAt ? ` · ${t("library.conflictWatchedAt", { time: formatDateTime(conflict.watchedAt) })}` : ""}
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-destructive"
                      checked={shouldDelete}
                      disabled={isResolving}
                      onChange={() => toggleDelete(conflict.episodeId)}
                    />
                    <span className={shouldDelete ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {shouldDelete ? t("library.deleteConflict") : t("library.keepConflict")}
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={isResolving} onClick={onCancel}>{t("library.cancel")}</Button>
          <Button
            type="button"
            className={deleteCount > 0 ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            disabled={isResolving}
            onClick={() => onConfirm([...deleteIds])}
          >
            {deleteCount > 0 ? t("library.resolveConflictsWithDelete", { count: deleteCount }) : t("library.resolveConflictsKeep")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
