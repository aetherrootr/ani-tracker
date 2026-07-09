"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { getTrackingList, getTrackingListPage, updateEpisodeWatchState } from "@/features/library/api";
import type { TrackingListKey } from "@/features/library/api";
import { useTrackingList } from "@/features/library/hooks";
import type { TrackingListItem, TrackingListResponse } from "@/features/library/types";

import { SkeletonBlock } from "./LibraryPagination";
import { TrackingEpisodeRow } from "./TrackingEpisodeRow";

const TRACKING_TABS = ["tracking", "backlog", "recentlyWatched"] as const satisfies readonly TrackingListKey[];

export function TrackingListPageContent() {
  const t = useTranslations();
  const { data, setData, isLoading, error, retry } = useTrackingList();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loadingMoreKey, setLoadingMoreKey] = useState<TrackingListKey | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState<TrackingListKey>("tracking");
  const isDesktop = useDesktopLayout();
  const tracking = data?.tracking.items ?? [];
  const backlog = data?.backlog.items ?? [];
  const recentlyWatched = data?.recentlyWatched.items ?? [];
  const hasQueueItems = tracking.length > 0 || backlog.length > 0;

  useEffect(() => {
    document.documentElement.classList.add("tracking-list-scroll-lock");
    document.body.classList.add("tracking-list-scroll-lock");
    return () => {
      document.documentElement.classList.remove("tracking-list-scroll-lock");
      document.body.classList.remove("tracking-list-scroll-lock");
    };
  }, []);

  async function handleWatchChange(listKey: TrackingListKey, item: TrackingListItem, watched: boolean) {
    if (!data) {
      return;
    }

    const previousIndex = data[listKey].items.findIndex((candidate) => candidate.episode.id === item.episode.id);
    const operationKey = `${listKey}-${item.anime.id}-${item.episode.id}`;
    setSavingKey(operationKey);

    try {
      await updateEpisodeWatchState(item.anime.id, item.episode.id, watched);
      const next = await getTrackingList();
      setData(watched && listKey !== "recentlyWatched" ? keepAnimeAtPosition(next, listKey, item.anime.id, previousIndex) : next);
    } catch {
      // Keep the current row visible if saving fails; this path has no optimistic mutation to roll back.
    } finally {
      setSavingKey(null);
    }
  }

  async function handleLoadMore(listKey: TrackingListKey) {
    if (!data || loadingMoreKey !== null || listKey === "recentlyWatched") {
      return;
    }

    setLoadingMoreKey(listKey);
    try {
      const current = data[listKey];
      const next = await getTrackingListPage({
        list: listKey,
        limit: current.limit,
        offset: current.offset + current.items.length,
      });
      setData({
        ...data,
        [listKey]: {
          ...next,
          items: mergeTrackingItems(current.items, next.items),
        },
      });
    } finally {
      setLoadingMoreKey(null);
    }
  }

  return (
    <div className="flex h-[calc(100svh-9.25rem)] flex-col space-y-4 overflow-hidden sm:block sm:h-auto sm:overflow-visible sm:space-y-6">
      <div className="mx-auto max-w-5xl space-y-2 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">{t("tracking.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("tracking.title")}</h1>
      </div>

      {error ? (
        <div className="mx-auto max-w-5xl rounded-2xl border bg-card p-8 text-center shadow-sm">
          <p className="font-medium">{t("tracking.loadFailed")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-4" onClick={retry}>{t("search.retry")}</Button>
        </div>
      ) : null}

      {!error ? (
        <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col rounded-3xl border bg-card/70 p-3 shadow-sm sm:block sm:p-5">
          {!isLoading && !hasQueueItems ? (
            <div className="mb-4 rounded-2xl bg-background/60 p-6 text-center font-medium sm:mb-6 sm:p-8">
              {t("tracking.emptyAll")}
            </div>
          ) : null}

          <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1 sm:hidden">
            {TRACKING_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={activeMobileTab === tab ? "rounded-xl bg-background px-2 py-2 text-sm font-medium shadow-sm" : "rounded-xl px-2 py-2 text-sm font-medium text-muted-foreground"}
                onClick={() => setActiveMobileTab(tab)}
              >
                {tab === "tracking" ? t("tracking.trackingSection") : tab === "backlog" ? t("tracking.backlogSection") : t("tracking.recentlyWatchedSection")}
              </button>
            ))}
          </div>

          {isDesktop ? (
          <div className="space-y-8">
            <TrackingSection
              title={t("tracking.trackingSection")}
              items={tracking}
              total={data?.tracking.total ?? 0}
              hasMore={data?.tracking.hasMore ?? false}
              isLoading={isLoading}
              isLoadingMore={loadingMoreKey === "tracking"}
              emptyText={t("tracking.emptyTracking")}
              savingKey={savingKey}
              listKey="tracking"
              onWatchChange={handleWatchChange}
              onLoadMore={handleLoadMore}
            />
            <TrackingSection
              title={t("tracking.backlogSection")}
              items={backlog}
              total={data?.backlog.total ?? 0}
              hasMore={data?.backlog.hasMore ?? false}
              isLoading={isLoading}
              isLoadingMore={loadingMoreKey === "backlog"}
              emptyText={t("tracking.emptyBacklog")}
              savingKey={savingKey}
              listKey="backlog"
              onWatchChange={handleWatchChange}
              onLoadMore={handleLoadMore}
            />
            <TrackingSection
              title={t("tracking.recentlyWatchedSection")}
              items={recentlyWatched}
              total={data?.recentlyWatched.total ?? 0}
              hasMore={data?.recentlyWatched.hasMore ?? false}
              allowLoadMore={false}
              isLoading={isLoading}
              isLoadingMore={loadingMoreKey === "recentlyWatched"}
              emptyText={t("tracking.emptyRecentlyWatched")}
              savingKey={savingKey}
              listKey="recentlyWatched"
              onWatchChange={handleWatchChange}
              onLoadMore={handleLoadMore}
            />
          </div>
          ) : null}

          {!isDesktop ? (
          <div className="min-h-0 flex-1">
            {activeMobileTab === "tracking" ? (
              <TrackingSection
                title={t("tracking.trackingSection")}
                items={tracking}
                total={data?.tracking.total ?? 0}
                hasMore={data?.tracking.hasMore ?? false}
                isLoading={isLoading}
                isLoadingMore={loadingMoreKey === "tracking"}
                emptyText={t("tracking.emptyTracking")}
                savingKey={savingKey}
                listKey="tracking"
                fillAvailableHeight
                hideHeaderOnMobile
                onWatchChange={handleWatchChange}
                onLoadMore={handleLoadMore}
              />
            ) : null}
            {activeMobileTab === "backlog" ? (
              <TrackingSection
                title={t("tracking.backlogSection")}
                items={backlog}
                total={data?.backlog.total ?? 0}
                hasMore={data?.backlog.hasMore ?? false}
                isLoading={isLoading}
                isLoadingMore={loadingMoreKey === "backlog"}
                emptyText={t("tracking.emptyBacklog")}
                savingKey={savingKey}
                listKey="backlog"
                fillAvailableHeight
                hideHeaderOnMobile
                onWatchChange={handleWatchChange}
                onLoadMore={handleLoadMore}
              />
            ) : null}
            {activeMobileTab === "recentlyWatched" ? (
              <TrackingSection
                title={t("tracking.recentlyWatchedSection")}
                items={recentlyWatched}
                total={data?.recentlyWatched.total ?? 0}
                hasMore={data?.recentlyWatched.hasMore ?? false}
                allowLoadMore={false}
                isLoading={isLoading}
                isLoadingMore={loadingMoreKey === "recentlyWatched"}
                emptyText={t("tracking.emptyRecentlyWatched")}
                savingKey={savingKey}
                listKey="recentlyWatched"
                fillAvailableHeight
                hideHeaderOnMobile
                onWatchChange={handleWatchChange}
                onLoadMore={handleLoadMore}
              />
            ) : null}
          </div>
          ) : null}
        </main>
      ) : null}
    </div>
  );
}

function useDesktopLayout() {
  return useSyncExternalStore(subscribeToViewport, getDesktopSnapshot, getServerSnapshot);
}

function subscribeToViewport(onStoreChange: () => void) {
  const query = window.matchMedia("(min-width: 640px)");
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getDesktopSnapshot() {
  return window.matchMedia("(min-width: 640px)").matches;
}

function getServerSnapshot() {
  return false;
}

function TrackingSection({
  title,
  items,
  total,
  hasMore,
  allowLoadMore = true,
  fillAvailableHeight = false,
  hideHeaderOnMobile = false,
  isLoading,
  isLoadingMore,
  emptyText,
  savingKey,
  listKey,
  onWatchChange,
  onLoadMore,
}: {
  title: string;
  items: TrackingListItem[];
  total: number;
  hasMore: boolean;
  allowLoadMore?: boolean;
  fillAvailableHeight?: boolean;
  hideHeaderOnMobile?: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  emptyText: string;
  savingKey: string | null;
  listKey: TrackingListKey;
  onWatchChange: (listKey: TrackingListKey, item: TrackingListItem, watched: boolean) => Promise<void>;
  onLoadMore: (listKey: TrackingListKey) => Promise<void>;
}) {
  const t = useTranslations();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  function updateScrollHints() {
    const element = scrollRef.current;
    if (!element) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;
    setCanScrollUp(element.scrollTop > 1);
    setCanScrollDown(element.scrollTop < maxScrollTop - 1);
  }

  function scrollList(direction: "up" | "down") {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollBy({
      top: (direction === "up" ? -1 : 1) * Math.max(element.clientHeight * 0.65, 220),
      behavior: "smooth",
    });
  }

  useEffect(() => {
    updateScrollHints();
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [items.length, isLoading, hasMore]);

  return (
    <section className={fillAvailableHeight ? "flex h-full min-h-0 flex-col" : undefined}>
      <div className={hideHeaderOnMobile ? "mb-3 hidden items-center justify-between gap-3 sm:mb-4 sm:flex" : "mb-3 flex items-center justify-between gap-3 sm:mb-4"}>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {t("tracking.itemCount", { count: items.length })}
          {total > items.length ? ` / ${total}` : ""}
        </span>
      </div>

      <div className={fillAvailableHeight ? "relative min-h-0 flex-1" : "relative"}>
        {canScrollUp ? (
          <button
            type="button"
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center bg-gradient-to-b from-card/80 to-transparent pb-5 pt-2 sm:pointer-events-auto"
            aria-label={t("tracking.scrollUp")}
            onClick={() => scrollList("up")}
          >
            <ChevronUp className="h-7 w-7 text-foreground/45" />
          </button>
        ) : null}
        {canScrollDown ? (
          <button
            type="button"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-card/80 to-transparent pb-2 pt-5 sm:pointer-events-auto"
            aria-label={t("tracking.scrollDown")}
            onClick={() => scrollList("down")}
          >
            <ChevronDown className="h-7 w-7 text-foreground/45" />
          </button>
        ) : null}
        <div ref={scrollRef} className={fillAvailableHeight ? "scrollbar-none h-full overflow-y-auto overscroll-contain" : "scrollbar-none max-h-[34rem] overflow-y-auto"} onScroll={updateScrollHints}>
        <div className="space-y-3 pb-1">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-28 rounded-2xl" />)
          ) : items.length > 0 ? (
            items.map((item) => (
              <TrackingEpisodeRow
                key={`${listKey}-${item.anime.id}-${item.episode.id}`}
                item={item}
                disabled={savingKey !== null}
                isSaving={savingKey === `${listKey}-${item.anime.id}-${item.episode.id}`}
                onWatchChange={(nextItem, watched) => onWatchChange(listKey, nextItem, watched)}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-dashed bg-background/60 p-8 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          )}
          {!isLoading && hasMore && allowLoadMore ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isLoadingMore || savingKey !== null}
              onClick={() => void onLoadMore(listKey)}
            >
              {isLoadingMore ? t("search.loadingMore") : t("tracking.loadMore")}
            </Button>
          ) : null}
        </div>
        </div>
      </div>
    </section>
  );
}

function keepAnimeAtPosition(data: TrackingListResponse, listKey: "tracking" | "backlog", animeId: number, index: number) {
  const page = data[listKey];
  const nextItem = page.items.find((item) => item.anime.id === animeId);
  if (!nextItem) {
    return data;
  }

  const withoutItem = page.items.filter((item) => item.anime.id !== animeId);
  const insertAt = Math.min(Math.max(index, 0), withoutItem.length);
  return {
    ...data,
    [listKey]: {
      ...page,
      items: [
        ...withoutItem.slice(0, insertAt),
        nextItem,
        ...withoutItem.slice(insertAt),
      ],
    },
  };
}

function mergeTrackingItems(currentItems: TrackingListItem[], nextItems: TrackingListItem[]) {
  const seen = new Set(currentItems.map((item) => item.episode.id));
  const merged = [...currentItems];
  for (const item of nextItems) {
    if (seen.has(item.episode.id)) {
      continue;
    }
    seen.add(item.episode.id);
    merged.push(item);
  }
  return merged;
}
