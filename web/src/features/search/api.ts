import { apiFetch } from "@/lib/api-client";

import type { AnimeSearchResponse, SearchAnimeInput } from "./types";

export function searchAnime({
  keyword,
  limit = 10,
  offset = 0,
  signal,
}: SearchAnimeInput): Promise<AnimeSearchResponse> {
  const params = new URLSearchParams({
    q: keyword,
    provider: "bangumi",
    limit: String(limit),
    offset: String(offset),
  });

  return apiFetch<AnimeSearchResponse>(`/api/anime/search?${params.toString()}`, {
    signal,
  });
}
