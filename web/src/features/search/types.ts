export type AnimeSearchResponse = {
  total: number;
  limit: number;
  offset: number;
  results: AnimeSearchResult[];
};

export type TvdbSeasonsResponse = {
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
  inLibrary: boolean;
  animeId: number | null;
  libraryStatus: string | null;
};

export type SearchAnimeInput = {
  keyword: string;
  provider?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
};

export type DuplicateAnimeCandidate = {
  animeId: number;
  provider: string;
  externalId: string;
  displayName: string;
  originalName: string;
  airDate: string | null;
  episodeCount: number | null;
  url: string | null;
};

export type DuplicateAnimeConflict = {
  provider: string;
  externalId: string;
  title: string;
  candidates: DuplicateAnimeCandidate[];
};

export type DuplicateResolution = {
  useExistingAnimeId?: number;
  useCurrentProvider?: boolean;
};
