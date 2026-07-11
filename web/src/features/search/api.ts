import { apiFetch } from "@/lib/api-client";

import type { AnimeSearchResponse, SearchAnimeInput } from "./types";

type AddToLibraryResponse = {
  anime: { id: number };
  progress: { status: string };
};

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

export function addSearchResultToLibrary(provider: string, externalId: string) {
  return apiFetch<AddToLibraryResponse>("/api/anime/library", {
    method: "POST",
    body: JSON.stringify({ provider, externalId }),
  });
}
