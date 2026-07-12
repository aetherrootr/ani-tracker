import { apiFetch } from "@/lib/api-client";

import type {
  AnimeDetailResponse,
  AnimeSyncResponse,
  AnimeName,
  AnimePoster,
  AnimeProgress,
  AnimeSummary,
  EpisodeListResponse,
  ImportProvidersResponse,
  LibraryResponse,
  ProviderSwitchResponse,
  ResolveEpisodeConflictsResponse,
  LibrarySort,
  LibraryStatusFilter,
  SortOrder,
  TrackingListPage,
  TrackingListResponse,
  TrackingListItem,
  UserAnimeStatus,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export function assetUrl(path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (/^https?:\/\//.test(path)) {
    return path;
  }

  return `${API_BASE_URL}${path}`;
}

function backendSort(sort: LibrarySort) {
  if (sort === "updatedAt") {
    return "updated_at";
  }
  if (sort === "airDate") {
    return "air_date";
  }
  return sort;
}

export function getLibrary(input: {
  q: string;
  status: LibraryStatusFilter;
  provider: string;
  sort: LibrarySort;
  order: SortOrder;
  pageSize: number;
  page: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    limit: String(input.pageSize),
    offset: String(Math.max(input.page - 1, 0) * input.pageSize),
    sort: backendSort(input.sort),
    order: input.order,
  });

  if (input.q) {
    params.set("q", input.q);
  }
  if (input.status !== "all") {
    params.set("status", input.status);
  }
  if (input.provider !== "all") {
    params.set("provider", input.provider);
  }

  return apiFetch<LibraryResponse>(`/api/anime/library?${params.toString()}`, {
    signal: input.signal,
  });
}

export function getAnimeDetail(animeId: number, signal?: AbortSignal) {
  return apiFetch<AnimeDetailResponse>(`/api/anime/${animeId}`, { signal });
}

export function getImportProviders(signal?: AbortSignal) {
  return apiFetch<ImportProvidersResponse>("/api/anime/providers", { signal });
}

export function switchAnimeProvider(animeId: number, provider: string, externalId: string) {
  return apiFetch<ProviderSwitchResponse>(`/api/anime/library/${animeId}/provider-switch`, {
    method: "POST",
    body: JSON.stringify({ provider, externalId }),
  });
}

export function getEpisodes(input: {
  animeId: number;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    limit: String(input.pageSize),
    offset: String(Math.max(input.page - 1, 0) * input.pageSize),
  });

  return apiFetch<EpisodeListResponse>(
    `/api/anime/library/${input.animeId}/episodes?${params.toString()}`,
    { signal: input.signal },
  );
}

export type TrackingListKey = "tracking" | "backlog" | "recentlyWatched";

const TRACKING_LIST_ENDPOINTS: Record<TrackingListKey, string> = {
  tracking: "tracking",
  backlog: "backlog",
  recentlyWatched: "recently-watched",
};

export function getTrackingListPage(input: {
  list: TrackingListKey;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }

  const query = params.toString();
  return apiFetch<TrackingListPage<TrackingListItem>>(
    `/api/watch-state/tracking-list/${TRACKING_LIST_ENDPOINTS[input.list]}${query ? `?${query}` : ""}`,
    { signal: input.signal },
  );
}

export async function getTrackingList(signal?: AbortSignal) {
  const [tracking, backlog, recentlyWatched] = await Promise.all([
    getTrackingListPage({ list: "tracking", signal }),
    getTrackingListPage({ list: "backlog", signal }),
    getTrackingListPage({ list: "recentlyWatched", signal }),
  ]);
  return { tracking, backlog, recentlyWatched } satisfies TrackingListResponse;
}

export function updateAnimeStatus(animeId: number, status: UserAnimeStatus) {
  return apiFetch<{ progress: AnimeProgress }>(`/api/anime/library/${animeId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function syncAnime(animeId: number) {
  return apiFetch<AnimeSyncResponse>(`/api/anime/library/${animeId}/sync`, { method: "POST" });
}

export function syncAllLibraryAnime() {
  return apiFetch<{ queued: boolean; taskId: string }>("/api/anime/library/sync-all", { method: "POST" });
}

export function resolveEpisodeConflicts(animeId: number, deleteEpisodeIds: number[]) {
  return apiFetch<ResolveEpisodeConflictsResponse>(`/api/anime/library/${animeId}/sync/episode-conflicts/resolve`, {
    method: "POST",
    body: JSON.stringify({ deleteEpisodeIds }),
  });
}

export function updateEpisodeWatchState(animeId: number, episodeId: number, watched: boolean) {
  return apiFetch<{ episode: { id: number; watched: boolean }; progress: AnimeProgress }>(
    `/api/watch-state/anime/${animeId}/episodes/${episodeId}`,
    { method: "PATCH", body: JSON.stringify({ watched }) },
  );
}

export function updateAnimeNamePreference(animeId: number, nameId: number | null) {
  return apiFetch<{ name: AnimeName | null; progress: { preferredNameId: number | null } }>(
    `/api/anime/library/${animeId}/name-preference`,
    { method: "PATCH", body: JSON.stringify({ nameId }) },
  );
}

export function updateSummaryPreference(animeId: number, summaryId: number | null) {
  return apiFetch<{ summary: AnimeSummary | null; progress: { preferredSummaryId: number | null } }>(
    `/api/anime/library/${animeId}/summary-preference`,
    { method: "PATCH", body: JSON.stringify({ summaryId }) },
  );
}

export function updatePosterPreference(animeId: number, posterId: number | null) {
  return apiFetch<{ poster: AnimePoster | null; progress: { preferredPosterId: number | null } }>(
    `/api/anime/library/${animeId}/poster-preference`,
    { method: "PATCH", body: JSON.stringify({ posterId }) },
  );
}

export function updateEpisodeNamePreference(animeId: number, episodeId: number, nameId: number | null) {
  return apiFetch<{ name: AnimeName | null; episode: { preferredNameId: number | null } }>(
    `/api/anime/library/${animeId}/episodes/${episodeId}/name-preference`,
    { method: "PATCH", body: JSON.stringify({ nameId }) },
  );
}
