import { apiFetch } from "@/lib/api-client";

import type { StatisticsSummary, WatchTimelinePage } from "./types";

export function getStatisticsSummary(signal?: AbortSignal) {
  return apiFetch<StatisticsSummary>("/api/statistics/summary", { signal });
}

export function recalculateStatistics() {
  return apiFetch<StatisticsSummary>("/api/statistics/recalculate", { method: "POST" });
}

export function getWatchTimelinePage(input: { limit: number; offset: number; signal?: AbortSignal }) {
  const params = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) });
  return apiFetch<WatchTimelinePage>(`/api/watch-state/watch-timeline?${params.toString()}`, {
    signal: input.signal,
  });
}
