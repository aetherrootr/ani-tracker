"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getAnimeDetail, getEpisodes, getLibrary, getTrackingList } from "./api";
import type {
  AnimeDetailResponse,
  EpisodeListResponse,
  LibraryResponse,
  LibraryListFilter,
  LibrarySeasonZeroFilter,
  LibrarySort,
  LibraryStatusFilter,
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

function validList(value: string | null): LibraryListFilter {
  if (value === "tracking" || value === "backlog") {
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

  const width = gridElement?.getBoundingClientRect().width ?? window.innerWidth;
  const gridColumns = gridElement ? getGridColumnCount(gridElement) : 0;
  const columns = gridColumns || (window.innerWidth < 640 ? 1 : window.innerWidth < 1024 ? 3 : window.innerWidth < 1280 ? 4 : 5);
  if (window.innerWidth < 640) {
    return 18;
  }

  const cardWidth = width / columns;
  const cardHeight = window.innerWidth < 640 ? 172 : cardWidth * 1.5 + 150;
  const gridTop = gridElement?.getBoundingClientRect().top ?? 220;
  const availableHeight = Math.max(cardHeight, window.innerHeight - gridTop - 120);
  const targetDesktopItems = 25;
  const rows = Math.max(Math.ceil(targetDesktopItems / columns), Math.ceil(availableHeight / cardHeight));
  return Math.min(100, Math.max(columns * rows, columns * 2));
}

function getGridColumnCount(element: HTMLElement) {
  const template = window.getComputedStyle(element).gridTemplateColumns;
  if (!template || template === "none") {
    return 0;
  }
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
  const list = validList(searchParams.get("list"));
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
    list: LibraryListFilter;
    seasonZero: LibrarySeasonZeroFilter;
    sort: LibrarySort;
    order: SortOrder;
    page: number;
    pageSize: number;
  }>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { q, status, provider, list, seasonZero, sort, order, page, pageSize, ...next };

    setParam(params, "q", merged.q, "");
    setParam(params, "status", merged.status, "all");
    setParam(params, "provider", merged.provider, "all");
    setParam(params, "list", merged.list, "all");
    setParam(params, "seasonZero", merged.seasonZero, "exclude");
    setParam(params, "sort", merged.sort, "updatedAt");
    setParam(params, "order", merged.order, "desc");
    setParam(params, "page", String(merged.page), "1");
    setParam(params, "pageSize", String(merged.pageSize), String(DEFAULT_LIBRARY_PAGE_SIZE));

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return { q, status, provider, list, seasonZero, sort, order, page, pageSize, hasPageSize, update, isPending };
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
  list: LibraryListFilter;
  seasonZero: LibrarySeasonZeroFilter;
  sort: LibrarySort;
  order: SortOrder;
  page: number;
  pageSize: number;
}) {
  const { q, status, provider, list, seasonZero, sort, order, page, pageSize } = query;
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getLibrary({ q, status, provider, list, seasonZero, sort, order, page, pageSize, signal: controller.signal })
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
  }, [q, status, provider, list, seasonZero, sort, order, page, pageSize, retryKey]);

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

export function useEpisodes(animeId: number, page: number, refreshKey = 0) {
  const [data, setData] = useState<EpisodeListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    getEpisodes({ animeId, page, pageSize: EPISODE_PAGE_SIZE, signal: controller.signal })
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
  }, [animeId, page, refreshKey, retryKey]);

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
