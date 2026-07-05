export type AnimeSearchResponse = {
  total: number;
  limit: number;
  offset: number;
  results: AnimeSearchResult[];
};

export type AnimeSearchResult = {
  provider: string;
  externalId: string;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  airDate: string | null;
  platform: string | null;
  episodeCount: number | null;
  imageUrl: string | null;
  url: string;
  rawData: Record<string, unknown>;
};

export type SearchAnimeInput = {
  keyword: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};
