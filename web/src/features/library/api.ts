import { apiFetch } from "@/lib/api-client";

import type {
  AnimeDetailResponse,
  AnimeSyncResponse,
  AnimeName,
  AnimePoster,
  AnimeProgress,
  AnimeSummary,
  EpisodeListResponse,
  EpisodeFilter,
  EpisodeOrder,
  ImportProvidersResponse,
  LibraryResponse,
  LibraryRefreshJob,
  LibraryRefreshResponse,
  ManualRelatedAnime,
  MetadataSourceResponse,
  ProviderSwitchResponse,
  LibraryAirStatusFilter,
  LibrarySeasonZeroFilter,
  LibrarySort,
  LibraryStatusFilter,
  LibraryUnwatchedFilter,
  RelatedAnimeDiscoveryJobResponse,
  TrackingListPage,
  TrackingListResponse,
  TrackingListItem,
  SortOrder,
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
  unwatched: LibraryUnwatchedFilter;
  airStatus: LibraryAirStatusFilter;
  seasonZero: LibrarySeasonZeroFilter;
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
  if (input.unwatched !== "all") {
    params.set("unwatched", input.unwatched);
  }
  if (input.airStatus !== "all") {
    params.set("airStatus", input.airStatus);
  }
  if (input.seasonZero !== "exclude") {
    params.set("seasonZero", input.seasonZero);
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

export function switchAnimeProvider(animeId: number, provider: string, externalId: string, confirm = false) {
  return apiFetch<ProviderSwitchResponse>(`/api/anime/library/${animeId}/provider-switch`, {
    method: "POST",
    body: JSON.stringify({ provider, externalId, confirm }),
  });
}

export function updateMetadataSource(animeId: number, source: "upstream" | "local_snapshot") {
  return apiFetch<MetadataSourceResponse>(`/api/anime/library/${animeId}/metadata-source`, {
    method: "PATCH",
    body: JSON.stringify({ source }),
  });
}

export function getEpisodes(input: {
  animeId: number;
  page: number;
  pageSize: number;
  q: string;
  filter: EpisodeFilter;
  order: EpisodeOrder;
  locateEpisodeNumber?: number | null;
  locateEpisodeId?: number | null;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    limit: String(input.pageSize),
    offset: String(Math.max(input.page - 1, 0) * input.pageSize),
    order: input.order,
  });

  if (input.q) params.set("q", input.q);
  if (input.filter !== "all") params.set("filter", input.filter);
  if (input.locateEpisodeNumber) params.set("locateEpisodeNumber", String(input.locateEpisodeNumber));
  if (input.locateEpisodeId) params.set("locateEpisodeId", String(input.locateEpisodeId));

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

export function syncAiringAnime() {
  return apiFetch<LibraryRefreshResponse>("/api/anime/airing/sync", { method: "POST" });
}

export async function getCurrentAiringAnimeRefreshJob(signal?: AbortSignal) {
  const response = await apiFetch<{ job: LibraryRefreshJob | null }>("/api/anime/airing/sync", { signal });
  return response.job;
}

export function getAiringAnimeRefreshJob(jobId: string, signal?: AbortSignal) {
  return apiFetch<LibraryRefreshJob>(`/api/anime/airing/sync/${jobId}`, { signal });
}

export function discoverRelatedAnime(animeId: number) {
  return apiFetch<RelatedAnimeDiscoveryJobResponse>(`/api/anime/library/${animeId}/discover-related-anime`, { method: "POST" });
}

export function getRelatedAnimeDiscoveryJob(animeId: number, jobId: string, signal?: AbortSignal) {
  return apiFetch<LibraryRefreshJob>(`/api/anime/library/${animeId}/discover-related-anime/${jobId}`, { signal });
}

export async function getCurrentRelatedAnimeDiscoveryJob(animeId: number, signal?: AbortSignal) {
  const response = await apiFetch<{ job: LibraryRefreshJob | null }>(`/api/anime/library/${animeId}/discover-related-anime`, { signal });
  return response.job;
}

export function syncAllLibraryAnime() {
  return apiFetch<LibraryRefreshResponse>("/api/anime/library/sync-all", { method: "POST" });
}

export function syncFailedLibraryAnime() {
  return apiFetch<LibraryRefreshResponse>("/api/anime/library/sync-all/failed", { method: "POST" });
}

export async function getCurrentLibraryRefreshJob(signal?: AbortSignal) {
  const response = await apiFetch<{ job: LibraryRefreshJob | null }>("/api/anime/library/sync-all", { signal });
  return response.job;
}

export function getLibraryRefreshJob(jobId: string, signal?: AbortSignal) {
  return apiFetch<LibraryRefreshJob>(`/api/anime/library/sync-all/${jobId}`, { signal });
}

export function updateEpisodeWatchState(animeId: number, episodeId: number, watched: boolean) {
  return apiFetch<{ episode: { id: number; watched: boolean }; progress: AnimeProgress }>(
    `/api/watch-state/anime/${animeId}/episodes/${episodeId}`,
    { method: "PATCH", body: JSON.stringify({ watched }) },
  );
}

export function updateEpisodeWatchStateBulk(
  animeId: number,
  input: { watched: boolean; scope: "all" | "aired" | "through"; throughEpisodeNumber?: number },
) {
  return apiFetch<{
    matchedCount: number;
    changedCount: number;
    progress: AnimeProgress;
  }>(`/api/watch-state/anime/${animeId}/episodes`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
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

export function updateRelatedAnimeOverride(animeId: number, relationId: number, relatedAnimeId: number | null, allowProviderImport?: boolean) {
  const body: { relatedAnimeId: number | null; allowProviderImport?: boolean } = { relatedAnimeId };
  if (allowProviderImport !== undefined) {
    body.allowProviderImport = allowProviderImport;
  }
  return apiFetch<{ override: { relationId: number; relatedAnimeId: number } | null }>(
    `/api/anime/library/${animeId}/related-anime/${relationId}/override`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function updateRelatedAnimeProviderImport(animeId: number, relationId: number, allowProviderImport: boolean) {
  return apiFetch<{ override: { relationId: number; relatedAnimeId: number; allowProviderImport: boolean } }>(
    `/api/anime/library/${animeId}/related-anime/${relationId}/override`,
    { method: "PATCH", body: JSON.stringify({ allowProviderImport }) },
  );
}

export function getManualRelatedAnime(animeId: number, signal?: AbortSignal) {
  return apiFetch<{ manualRelatedAnime: ManualRelatedAnime[] }>(`/api/anime/library/${animeId}/manual-related-anime`, { signal });
}

export function createManualRelatedAnime(animeId: number, relatedAnimeId: number, relationType = "same_series_manual", note?: string) {
  return apiFetch<{ manualRelation: ManualRelatedAnime }>(
    `/api/anime/library/${animeId}/manual-related-anime`,
    { method: "POST", body: JSON.stringify({ relatedAnimeId, relationType, note }) },
  );
}

export function updateManualRelatedAnime(animeId: number, manualRelationId: number, input: { relationType?: string; note?: string | null }) {
  return apiFetch<{ manualRelation: ManualRelatedAnime }>(
    `/api/anime/library/${animeId}/manual-related-anime/${manualRelationId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteManualRelatedAnime(animeId: number, manualRelationId: number) {
  return apiFetch<void>(`/api/anime/library/${animeId}/manual-related-anime/${manualRelationId}`, { method: "DELETE" });
}

export function keepDeletedRelatedAnime(animeId: number, promptId: number) {
  return apiFetch<{ manualRelation: ManualRelatedAnime }>(`/api/anime/library/${animeId}/related-anime/deletion-prompts/${promptId}/keep`, { method: "POST" });
}

export function dismissDeletedRelatedAnime(animeId: number, promptId: number) {
  return apiFetch<void>(`/api/anime/library/${animeId}/related-anime/deletion-prompts/${promptId}`, { method: "DELETE" });
}
