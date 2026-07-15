"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { updateEpisodeWatchState } from "@/features/library/api";
import { EPISODE_PAGE_SIZE, useEpisodes } from "@/features/library/hooks";
import type { AnimeProgress, Episode } from "@/features/library/types";

import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeRow } from "./EpisodeRow";
import { EpisodeSearchMenu, type EpisodeFilter, type EpisodeOrder } from "./EpisodeSearchMenu";
import { EpisodeTitleSettingsMenu } from "./EpisodeTitleSettingsMenu";
import { LibraryPagination, SkeletonBlock } from "./LibraryPagination";

export function EpisodeList({ animeId, metadataSource, refreshKey = 0, onProgressChange }: { animeId: number; metadataSource: string; refreshKey?: number; onProgressChange: (progress: AnimeProgress) => void }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const initialEpisodeNumber = parsePositiveInt(searchParams.get("episode"));
  const [page, setPage] = useState(initialEpisodeNumber === null ? 1 : Math.ceil(initialEpisodeNumber / EPISODE_PAGE_SIZE));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<EpisodeFilter>("all");
  const [order, setOrder] = useState<EpisodeOrder>("asc");
  const [openMenu, setOpenMenu] = useState<"search" | "settings" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const { data, setData, isLoading, error, retry } = useEpisodes(animeId, page, refreshKey);
  const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes]);

  useEffect(() => {
    if (isLoading || typeof window === "undefined" || !window.location.hash.startsWith("#episode-")) {
      return;
    }
    const element = document.getElementById(window.location.hash.slice(1));
    if (element) {
      window.requestAnimationFrame(() => element.scrollIntoView({ block: "center" }));
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

  async function markMany(targets: Episode[], watched: boolean) {
    for (const episode of targets) {
      if (episode.watched !== watched) {
        await updateWatch(episode, watched);
      }
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t("library.episodes")}</h2>
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
              onPageChange={setPage}
              onEpisodeChange={(episode) => setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? episode : item) } : current)}
              onMarkTo={(episodeNumber) => void markMany(episodes.filter((episode) => episode.episodeNumber <= episodeNumber), true)}
              onMarkAired={() => void markMany(episodes.filter((episode) => episode.status === "aired"), true)}
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
            onCloseReset={() => {
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
          {visibleEpisodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} disabled={busyIds.has(episode.id)} onWatchChange={updateWatch} />)}
          {visibleEpisodes.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">{t("library.noEpisodes")}</div> : null}
        </div>
      )}

      <LibraryPagination page={page} totalPages={data?.totalPages ?? 0} total={data?.total ?? 0} disabled={isLoading} onPageChange={setPage} />

      <ConfirmDialog
        open={confirmClear}
        title={t("library.clearAllWatched")}
        description={t("library.confirmClearAll")}
        danger
        confirmLabel={t("library.clearAllWatched")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void markMany(episodes, false);
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
