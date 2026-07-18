"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getStatisticsSummary, getWatchTimelinePage, recalculateStatistics } from "./api";
import type { StatisticsSummary, WatchTimelineItem } from "./types";

const TIMELINE_PAGE_SIZE = 30;

export function useStatisticsSummary(weekStartDay?: number, includeUnwatchedSeasonZeroInStatistics?: boolean, timeZone?: string) {
  const [data, setData] = useState<StatisticsSummary | null>(null);
  const [lastReadyData, setLastReadyData] = useState<StatisticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getStatisticsSummary(controller.signal)
      .then((next) => {
        setData(next);
        if (next.status === "ready") {
          setLastReadyData(next);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [retryKey, weekStartDay, includeUnwatchedSeasonZeroInStatistics, timeZone]);

  async function recalculate() {
    setIsRefreshing(true);
    setError(null);
    try {
      const next = await recalculateStatistics();
      setData(next);
      if (next.status === "ready") {
        setLastReadyData(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }

  return { data, displayData: data?.status === "ready" ? data : lastReadyData, isLoading, isRefreshing, error, retry: () => setRetryKey((current) => current + 1), recalculate };
}

export function useWatchTimeline(preferredTimeZone?: string) {
  const [items, setItems] = useState<WatchTimelineItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [timeZone, setTimeZone] = useState("UTC");
  const [statisticsVersion, setStatisticsVersion] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const isInitialLoadingRef = useRef(true);
  const isLoadingMoreRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);
    offsetRef.current = 0;
    hasMoreRef.current = true;
    isInitialLoadingRef.current = true;
    isLoadingMoreRef.current = false;

    getWatchTimelinePage({ limit: TIMELINE_PAGE_SIZE, offset: 0, signal: controller.signal })
      .then((page) => {
        setItems(page.items);
        offsetRef.current = page.items.length;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setTotal(page.total);
        setTimeZone(page.timeZone);
        setStatisticsVersion(page.statisticsVersion);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          isInitialLoadingRef.current = false;
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [retryKey, preferredTimeZone]);

  const loadMore = useCallback(async () => {
    if (isInitialLoadingRef.current || isLoadingMoreRef.current || !hasMoreRef.current) {
      return;
    }
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setError(null);
    const currentOffset = offsetRef.current;
    try {
      const page = await getWatchTimelinePage({ limit: TIMELINE_PAGE_SIZE, offset: currentOffset });
      setItems((current) => {
        const seen = new Set(current.map(timelineItemKey));
        return [...current, ...page.items.filter((item) => !seen.has(timelineItemKey(item)))];
      });
      offsetRef.current = currentOffset + page.items.length;
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      setTotal(page.total);
      setTimeZone(page.timeZone);
      setStatisticsVersion(page.statisticsVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, []);

  return {
    items,
    total,
    timeZone,
    statisticsVersion,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    retry: () => setRetryKey((current) => current + 1),
    refresh: () => setRetryKey((current) => current + 1),
    loadMore,
  };
}

function timelineItemKey(item: WatchTimelineItem) {
  return `${item.episode.id}-${item.episode.watchedAt ?? ""}`;
}
