"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getAnimeDetail, getEpisodes, getLibrary, getTrackingList } from "./api";
import type {
  AnimeDetailResponse,
  EpisodeListResponse,
  EpisodeFilter,
  EpisodeOrder,
  LibraryResponse,
  LibraryAirStatusFilter,
  LibrarySeasonZeroFilter,
  LibrarySort,
  LibraryStatusFilter,
  LibraryUnwatchedFilter,
  SortOrder,
  TrackingListResponse,
} from "./types";

const DEFAULT_LIBRARY_PAGE_SIZE = 24;
export const EPISODE_PAGE_SIZE = 30;

export function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function validStatus(value: string | null): LibraryStatusFilter {
  if (
    value === "plan_to_watch" ||
    value === "watching" ||
    value === "completed" ||
    value === "on_hold"
  ) {
    return value;
  }
  return "all";
}

function validSort(value: string | null): LibrarySort {
  if (value === "name" || value === "airDate" || value === "updatedAt") {
    return value;
  }
  return "updatedAt";
}

function validUnwatched(value: string | null): LibraryUnwatchedFilter {
  if (value === "yes" || value === "no") {
    return value;
  }
  return "all";
}

function validAirStatus(value: string | null): LibraryAirStatusFilter {
  if (value === "notStarted" || value === "airing" || value === "completed") {
    return value;
  }
  return "all";
}

function validSeasonZero(value: string | null): LibrarySeasonZeroFilter {
  if (value === "include" || value === "only") {
    return value;
  }
  return "exclude";
}

function validOrder(value: string | null): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

export function calculateLibraryPageSize(gridElement?: HTMLElement | null) {
  if (typeof window === "undefined") {
    return DEFAULT_LIBRARY_PAGE_SIZE;
  }

  const desktop = window.matchMedia("(min-width: 768px) and (any-hover: hover) and (any-pointer: fine)").matches;
  if (!desktop) return 12;

  const width = gridElement?.getBoundingClientRect().width ?? window.innerWidth;
  const estimatedColumns = Math.max(1, Math.floor((width + 18) / 208));
  const columns = (gridElement ? getGridColumnCount(gridElement) : 0) || estimatedColumns;
  if (columns <= 2) return columns * 10;
  if (columns === 3) return 24;
  if (columns === 4) return 24;
  return Math.min(columns * 5, 100);
}

function getGridColumnCount(element: HTMLElement) {
  const template = window.getComputedStyle(element).gridTemplateColumns;
  if (!template || template === "none") return 0;
  return template.split(" ").filter(Boolean).length;
}

export function useLibraryQueryState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const q = searchParams.get("q") ?? "";
  const status = validStatus(searchParams.get("status"));
  const provider = searchParams.get("provider") || "all";
  const unwatched = validUnwatched(searchParams.get("unwatched"));
  const airStatus = validAirStatus(searchParams.get("airStatus"));
  const seasonZero = validSeasonZero(searchParams.get("seasonZero"));
  const sort = validSort(searchParams.get("sort"));
  const order = validOrder(searchParams.get("order"));
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const hasPageSize = searchParams.has("pageSize");
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), DEFAULT_LIBRARY_PAGE_SIZE);

  function update(next: Partial<{
    q: string;
    status: LibraryStatusFilter;
    provider: string;
    unwatched: LibraryUnwatchedFilter;
    airStatus: LibraryAirStatusFilter;
    seasonZero: LibrarySeasonZeroFilter;
    sort: LibrarySort;
    order: SortOrder;
    page: number;
    pageSize: number;
  }>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { q, status, provider, unwatched, airStatus, seasonZero, sort, order, page, pageSize, ...next };

    setParam(params, "q", merged.q, "");
    setParam(params, "status", merged.status, "all");
    setParam(params, "provider", merged.provider, "all");
    setParam(params, "unwatched", merged.unwatched, "all");
    setParam(params, "airStatus", merged.airStatus, "all");
    setParam(params, "seasonZero", merged.seasonZero, "exclude");
    setParam(params, "sort", merged.sort, "updatedAt");
    setParam(params, "order", merged.order, "desc");
    setParam(params, "page", String(merged.page), "1");
    setParam(params, "pageSize", String(merged.pageSize), String(DEFAULT_LIBRARY_PAGE_SIZE));

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return { q, status, provider, unwatched, airStatus, seasonZero, sort, order, page, pageSize, hasPageSize, update, isPending };
}

function setParam(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (!value || value === defaultValue) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

export function useLibraryData(query: {
  q: string;
  status: LibraryStatusFilter;
  provider: string;
  unwatched: LibraryUnwatchedFilter;
  airStatus: LibraryAirStatusFilter;
  seasonZero: LibrarySeasonZeroFilter;
  sort: LibrarySort;
  order: SortOrder;
  page: number;
  pageSize: number;
}) {
  const { q, status, provider, unwatched, airStatus, seasonZero, sort, order, page, pageSize } = query;
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getLibrary({ q, status, provider, unwatched, airStatus, seasonZero, sort, order, page, pageSize, signal: controller.signal })
      .then(setData)
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
  }, [q, status, provider, unwatched, airStatus, seasonZero, sort, order, page, pageSize, retryKey]);

  return { data, isLoading, error, retry: () => setRetryKey((current) => current + 1) };
}

export function useDebouncedValue(value: string, delay = 320) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

export function useAnimeDetail(animeId: number) {
  const [data, setData] = useState<AnimeDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getAnimeDetail(animeId, controller.signal)
      .then(setData)
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
  }, [animeId, retryKey]);

  return { data, setData, isLoading, error, retry: () => setRetryKey((current) => current + 1) };
}

export function useEpisodes(input: {
  animeId: number;
  page: number;
  q: string;
  filter: EpisodeFilter;
  order: EpisodeOrder;
  locateEpisodeNumber?: number | null;
  locateEpisodeId?: number | null;
  refreshKey?: number;
}) {
  const { animeId, page, q, filter, order, locateEpisodeNumber, locateEpisodeId, refreshKey } = input;
  const [data, setData] = useState<EpisodeListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getEpisodes({ animeId, page, q, filter, order, locateEpisodeNumber, locateEpisodeId, pageSize: EPISODE_PAGE_SIZE, signal: controller.signal })
      .then(setData)
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
  }, [animeId, filter, locateEpisodeId, locateEpisodeNumber, order, page, q, refreshKey, retryKey]);

  return useMemo(
    () => ({ data, setData, isLoading, error, retry: () => setRetryKey((current) => current + 1) }),
    [data, error, isLoading],
  );
}

export function useTrackingList() {
  const [data, setData] = useState<TrackingListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getTrackingList(controller.signal)
      .then(setData)
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
  }, [retryKey]);

  return useMemo(
    () => ({ data, setData, isLoading, error, retry: () => setRetryKey((current) => current + 1) }),
    [data, error, isLoading],
  );
}
