"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { updateEpisodeWatchState, updateEpisodeWatchStateBulk } from "@/features/library/api";
import { EPISODE_PAGE_SIZE, useEpisodes } from "@/features/library/hooks";
import type { AnimeProgress, Episode } from "@/features/library/types";

import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeRow } from "./EpisodeRow";
import { EpisodeSearchMenu, type EpisodeFilter, type EpisodeOrder } from "./EpisodeSearchMenu";
import { EpisodeTitleSettingsMenu } from "./EpisodeTitleSettingsMenu";
import { LibraryPagination, SkeletonBlock } from "./LibraryPagination";

export function EpisodeList({ animeId, metadataSource, progress, refreshKey = 0, onProgressChange }: { animeId: number; metadataSource: string; progress: AnimeProgress; refreshKey?: number; onProgressChange: (progress: AnimeProgress) => void }) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEpisodeNumber = parsePositiveInt(searchParams.get("episode"));
  const initialPage = parsePositiveInt(searchParams.get("page"));
  const [page, setPage] = useState(initialPage ?? (initialEpisodeNumber === null ? 1 : Math.ceil(initialEpisodeNumber / EPISODE_PAGE_SIZE)));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<EpisodeFilter>("all");
  const [order, setOrder] = useState<EpisodeOrder>("asc");
  const [openMenu, setOpenMenu] = useState<"search" | "settings" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { data, setData, isLoading, error, retry } = useEpisodes(animeId, page, refreshKey);
  const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes]);
  const nextEpisodeNumber = (progress.lastWatchedEpisodeNumber ?? 0) + 1;

  useEffect(() => {
    if (isLoading || typeof window === "undefined") {
      return;
    }
    const hashId = window.location.hash.startsWith("#episode-") ? window.location.hash.slice(1) : null;
    const element = document.getElementById(hashId ?? "");
    if (element) {
      window.requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        element.querySelector<HTMLElement>("[role='checkbox']")?.focus({ preventScroll: true });
      });
    }
  }, [isLoading, episodes]);

  const visibleEpisodes = useMemo(() => {
    const keyword = normalizeEpisodeSearchQuery(q);
    const episodePrefixMatch = keyword.match(/^e\s*[:：]\s*(\d+)$/i);
    return [...episodes]
      .filter((episode) => {
        if (!keyword) {
          return true;
        }
        if (episodePrefixMatch) {
          return String(episode.episodeNumber).startsWith(episodePrefixMatch[1]);
        }
        if (/^\d+$/.test(keyword)) {
          return false;
        }
        const displayName = (episode.displayName ?? "").toLocaleLowerCase();
        const originalTitle = (episode.originalTitle ?? "").toLocaleLowerCase();
        return displayName.includes(keyword) || originalTitle.includes(keyword);
      })
      .filter((episode) => filter === "all" || (filter === "watched" ? episode.watched : !episode.watched))
      .sort((a, b) => order === "asc" ? a.episodeNumber - b.episodeNumber : b.episodeNumber - a.episodeNumber);
  }, [episodes, filter, order, q]);

  async function updateWatch(episode: Episode, watched: boolean) {
    setBusyIds((current) => new Set(current).add(episode.id));
    setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? { ...item, watched } : item) } : current);
    try {
      const result = await updateEpisodeWatchState(animeId, episode.id, watched);
      onProgressChange(result.progress);
      setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? { ...item, watched: result.episode.watched } : item) } : current);
    } catch (err) {
      setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? episode : item) } : current);
      throw err;
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(episode.id);
        return next;
      });
    }
  }

  async function markMany(input: { watched: boolean; scope: "all" | "aired" | "through"; throughEpisodeNumber?: number }) {
    if (bulkPending) return;
    setBulkPending(true);
    setBulkError(null);
    setBulkMessage(null);
    try {
      const result = await updateEpisodeWatchStateBulk(animeId, input);
      onProgressChange(result.progress);
      setBulkMessage(t("library.bulkUpdateComplete", { changed: result.changedCount, matched: result.matchedCount }));
      retry();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : t("library.bulkUpdateFailed"));
    } finally {
      setBulkPending(false);
    }
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.delete("episode");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <section id="episode-list" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t("library.episodes")}</h2>
          {data ? <span className="ml-2 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{t("library.relatedAnimeEpisodeCount", { count: data.total })}</span> : null}
          {metadataSource === "local_snapshot" ? null : (
            <EpisodeTitleSettingsMenu
              animeId={animeId}
              episodes={episodes}
              page={page}
              totalPages={data?.totalPages ?? 0}
              total={data?.total ?? 0}
              isLoading={isLoading}
              open={openMenu === "settings"}
              onOpenChange={(open) => setOpenMenu(open ? "settings" : null)}
              onPageChange={changePage}
              onEpisodeChange={(episode) => setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? episode : item) } : current)}
              busy={bulkPending}
              onMarkTo={(episodeNumber) => void markMany({ watched: true, scope: "through", throughEpisodeNumber: episodeNumber })}
              onMarkAired={() => void markMany({ watched: true, scope: "aired" })}
              onClearAll={() => setConfirmClear(true)}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <EpisodeSearchMenu
            q={q}
            filter={filter}
            order={order}
            open={openMenu === "search"}
            onOpenChange={(open) => setOpenMenu(open ? "search" : null)}
            onReset={() => {
              setQ("");
              setFilter("all");
            }}
            onChange={(next) => {
              if (next.q !== undefined) setQ(next.q);
              if (next.filter !== undefined) setFilter(next.filter);
              if (next.order !== undefined) setOrder(next.order);
            }}
          />
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">{bulkMessage}</div>
      {bulkMessage ? <p className="rounded-xl border border-[color-mix(in_srgb,var(--watched)_28%,transparent)] bg-[color-mix(in_srgb,var(--watched)_8%,var(--surface-card))] px-3 py-2 text-sm" role="status">{bulkMessage}</p> : null}
      {bulkError ? <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert"><span>{bulkError}</span><Button type="button" size="sm" variant="outline" onClick={() => setBulkError(null)}>{t("library.dismiss")}</Button></div> : null}

      {error ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-3" onClick={retry}>{t("search.retry")}</Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 8 }).map((_, index) => <SkeletonBlock key={index} className="h-24" />)}</div>
      ) : (
        <div className="space-y-3">
          {visibleEpisodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} isNext={episode.episodeNumber === nextEpisodeNumber && !episode.watched} disabled={busyIds.has(episode.id) || bulkPending} onWatchChange={updateWatch} />)}
          {visibleEpisodes.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">{t("library.noEpisodes")}</div> : null}
        </div>
      )}

      {(data?.totalPages ?? 0) > 1 ? <LibraryPagination page={page} totalPages={data?.totalPages ?? 0} total={data?.total ?? 0} pageSize={30} disabled={isLoading || bulkPending} onPageChange={changePage} /> : null}

      <ConfirmDialog
        open={confirmClear}
        title={t("library.clearAllWatched")}
        description={t("library.confirmClearAll")}
        danger
        confirmLabel={t("library.clearAllWatched")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void markMany({ watched: false, scope: "all" });
        }}
      />
    </section>
  );
}

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function normalizeEpisodeSearchQuery(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
