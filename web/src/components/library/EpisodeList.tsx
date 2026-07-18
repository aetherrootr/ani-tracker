"use client";

import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { updateEpisodeWatchState, updateEpisodeWatchStateBulk } from "@/features/library/api";
import { useEpisodes } from "@/features/library/hooks";
import type { AnimeProgress, Episode, EpisodeFilter, EpisodeOrder } from "@/features/library/types";

import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeRangeNavigator } from "./EpisodeRangeNavigator";
import { EpisodeRow } from "./EpisodeRow";
import { EpisodeSearchMenu } from "./EpisodeSearchMenu";
import { EpisodeTitleSettingsMenu } from "./EpisodeTitleSettingsMenu";
import { SkeletonBlock } from "./LibraryPagination";

export function EpisodeList({ animeId, metadataSource, progress, refreshKey = 0, onProgressChange }: { animeId: number; metadataSource: string; progress: AnimeProgress; refreshKey?: number; onProgressChange: (progress: AnimeProgress) => void }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = parsePositiveInt(searchParams.get("page")) ?? 1;
  const locateEpisodeNumber = parsePositiveInt(searchParams.get("episode"));
  const q = searchParams.get("q") ?? "";
  const filter = parseEpisodeFilter(searchParams.get("filter"));
  const order = parseEpisodeOrder(searchParams.get("order"));
  const locateEpisodeId = parseEpisodeHash(useSyncExternalStore(subscribeToHash, getHashSnapshot, getServerHashSnapshot));
  const [openMenu, setOpenMenu] = useState<"search" | "settings" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const pendingRangePageRef = useRef<number | null>(null);
  const { data, setData, isLoading, error, retry } = useEpisodes({ animeId, page, q, filter, order, locateEpisodeNumber, locateEpisodeId, refreshKey });
  const episodes = useMemo(() => data?.episodes ?? [], [data?.episodes]);
  const nextEpisodeNumber = (progress.lastWatchedEpisodeNumber ?? 0) + 1;

  useEffect(() => {
    if (!data || data.q !== q || data.filter !== filter || data.order !== order) return;
    const targetPage = data.location?.page ?? (data.totalPages > 0 ? Math.min(page, data.totalPages) : 1);
    const targetHash = data.location ? `#episode-${data.location.id}` : "";
    if (targetPage === page && (!data.location || window.location.hash === targetHash)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (targetPage <= 1) params.delete("page");
    else params.set("page", String(targetPage));
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}${targetHash}`, { scroll: false });
  }, [data, filter, order, page, pathname, q, router, searchParams]);

  useEffect(() => {
    if (isLoading || pendingRangePageRef.current !== page || data?.page !== page) return;
    pendingRangePageRef.current = null;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    resultsRef.current?.scrollIntoView({ behavior, block: "start" });
    requestAnimationFrame(() => resultsRef.current?.focus({ preventScroll: true }));
  }, [data?.page, isLoading, page]);

  useEffect(() => {
    if (isLoading || typeof window === "undefined") {
      return;
    }
    const hashId = window.location.hash.startsWith("#episode-") ? window.location.hash.slice(1) : null;
    const element = document.getElementById(hashId ?? "");
    if (element) {
      window.requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        element.querySelector<HTMLElement>("input[type='checkbox'], [role='checkbox']")?.focus({ preventScroll: true });
      });
    }
  }, [isLoading, episodes]);

  async function updateWatch(episode: Episode, watched: boolean) {
    setBusyIds((current) => new Set(current).add(episode.id));
    setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? { ...item, watched } : item) } : current);
    try {
      const result = await updateEpisodeWatchState(animeId, episode.id, watched);
      onProgressChange(result.progress);
      setData((current) => current ? { ...current, episodes: current.episodes.map((item) => item.id === episode.id ? { ...item, watched: result.episode.watched } : item) } : current);
      if (filter !== "all") retry();
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
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    params.delete("episode");
    pendingRangePageRef.current = nextPage;
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  function jumpToEpisode(episodeNumber: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("episode", String(episodeNumber));
    const query = params.toString();
    router.push(`${pathname}?${query}`, { scroll: false });
  }

  function updateQuery(next: Partial<{ q: string; filter: EpisodeFilter; order: EpisodeOrder }>) {
    const params = new URLSearchParams(searchParams.toString());
    const nextQ = next.q ?? q;
    const nextFilter = next.filter ?? filter;
    const nextOrder = next.order ?? order;
    setQueryParam(params, "q", nextQ, "");
    setQueryParam(params, "filter", nextFilter, "all");
    setQueryParam(params, "order", nextOrder, "asc");
    params.delete("page");
    params.delete("episode");
    const query = params.toString();
    startTransition(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  }

  return (
    <section id="episode-list" className="episode-section-panel scroll-mt-24 overflow-visible rounded-3xl border bg-card shadow-sm" aria-labelledby="episode-list-title">
      <div className="episode-section-header flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-3 sm:flex-nowrap">
        <div className="flex min-w-0 items-center gap-1">
          <h2 id="episode-list-title" className="text-2xl font-semibold tracking-tight">{t("library.episodes")}</h2>
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
        <div className="episode-section-actions ml-auto flex min-w-0 items-center justify-end gap-2">
          {bulkMessage ? (
            <p className="episode-section-feedback inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold" role="status">
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{bulkMessage}</span>
            </p>
          ) : null}
          {data ? (
            <EpisodeRangeNavigator
              page={data.page}
              ranges={data.ranges}
              total={data.total}
              disabled={isLoading || bulkPending}
              placement="header"
              onPageChange={changePage}
              onEpisodeJump={jumpToEpisode}
            />
          ) : null}
          <EpisodeSearchMenu
            q={q}
            filter={filter}
            order={order}
            open={openMenu === "search"}
            onOpenChange={(open) => setOpenMenu(open ? "search" : null)}
            onReset={() => {
              updateQuery({ q: "", filter: "all" });
            }}
            onChange={updateQuery}
          />
        </div>
      </div>

      <div ref={resultsRef} className="episode-section-content scroll-mt-24 space-y-3 p-3 outline-none" role="region" aria-labelledby="episode-list-title" aria-busy={isLoading} tabIndex={-1}>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {episodeRangeStatus(t, data, page, isLoading)}
        </p>
        {bulkError ? <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface-card))] px-3 py-2 text-sm text-destructive" role="alert"><span>{bulkError}</span><Button type="button" size="sm" variant="outline" onClick={() => setBulkError(null)}>{t("library.dismiss")}</Button></div> : null}

        {error ? (
          <div className="rounded-2xl border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button type="button" className="mt-3" onClick={retry}>{t("search.retry")}</Button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 8 }).map((_, index) => <SkeletonBlock key={index} className="h-24" />)}</div>
        ) : (
          <div className="episode-list-stack">
            {episodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} isNext={episode.episodeNumber === nextEpisodeNumber && !episode.watched} disabled={busyIds.has(episode.id) || bulkPending} onWatchChange={updateWatch} />)}
            {episodes.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">{t("library.noEpisodes")}</div> : null}
          </div>
        )}

        {data ? (
          <EpisodeRangeNavigator
            page={data.page}
            ranges={data.ranges}
            total={data.total}
            disabled={isLoading || bulkPending}
            placement="footer"
            onPageChange={changePage}
            onEpisodeJump={jumpToEpisode}
          />
        ) : null}
      </div>

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

function parseEpisodeHash(hash: string) {
  const match = hash.match(/^#episode-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function subscribeToHash(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function getHashSnapshot() {
  return window.location.hash;
}

function getServerHashSnapshot() {
  return "";
}

function parseEpisodeFilter(value: string | null): EpisodeFilter {
  return value === "watched" || value === "unwatched" ? value : "all";
}

function parseEpisodeOrder(value: string | null): EpisodeOrder {
  return value === "desc" ? "desc" : "asc";
}

function setQueryParam(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (!value || value === defaultValue) params.delete(key);
  else params.set(key, value);
}

function episodeRangeStatus(t: ReturnType<typeof useTranslations>, data: ReturnType<typeof useEpisodes>["data"], requestedPage: number, isLoading: boolean) {
  if (!data || data.ranges.length === 0) return "";
  const range = data.ranges.find((item) => item.page === requestedPage) ?? data.ranges.find((item) => item.page === data.page) ?? data.ranges[0];
  return t(isLoading ? "library.episodeRangeLoading" : "library.episodeRangeShowing", {
    first: range.firstEpisodeNumber,
    last: range.lastEpisodeNumber,
    total: data.total,
  });
}
