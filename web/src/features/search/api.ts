import { apiFetch } from "@/lib/api-client";

import type { AnimeSearchResponse, DuplicateResolution, SearchAnimeInput, TvdbSeasonsResponse } from "./types";

type AddToLibraryResponse = {
  anime: { id: number };
  progress: { status: string };
};

const ADD_TO_LIBRARY_TIMEOUT_MS = 360000;

export function searchAnime({
  keyword,
  provider = "bangumi",
  limit = 10,
  offset = 0,
  signal,
}: SearchAnimeInput): Promise<AnimeSearchResponse> {
  const params = new URLSearchParams({
    q: keyword,
    provider,
    limit: String(limit),
    offset: String(offset),
  });

  return apiFetch<AnimeSearchResponse>(`/api/anime/search?${params.toString()}`, {
    signal,
  });
}

export function addSearchResultToLibrary(provider: string, externalId: string, duplicateResolution?: DuplicateResolution) {
  return apiFetch<AddToLibraryResponse>("/api/anime/library", {
    method: "POST",
    body: JSON.stringify({ provider, externalId, duplicateResolution }),
    timeoutMs: ADD_TO_LIBRARY_TIMEOUT_MS,
  });
}

export function getTvdbSeasons(externalId: string): Promise<TvdbSeasonsResponse> {
  const params = new URLSearchParams({ externalId });

  return apiFetch<TvdbSeasonsResponse>(`/api/anime/tvdb/seasons?${params.toString()}`, {
    timeoutMs: ADD_TO_LIBRARY_TIMEOUT_MS,
  });
}
