export type UserAnimeStatus = "plan_to_watch" | "watching" | "completed" | "on_hold" | "dropped";

export type LibraryStatusFilter = "all" | Exclude<UserAnimeStatus, "dropped">;
export type LibrarySort = "updatedAt" | "name" | "airDate";
export type SortOrder = "asc" | "desc";

export type AnimeName = {
  id: number;
  language: string | null;
  name: string;
};

export type AnimeSummary = {
  id: number;
  language: string | null;
  summary: string;
  isPreferred?: boolean;
};

export type AnimePoster = {
  id: number;
  status: "ready" | "pending" | "failed" | string;
  url: string;
  isPreferred: boolean;
};

export type Anime = {
  id: number;
  name: AnimeName | null;
  displayName: string;
  originalName: string;
  summary: AnimeSummary | null;
  posterUrl: string | null;
  poster: AnimePoster | null;
  preferredNameId: number | null;
  preferredPosterId: number | null;
  posterStatus: string | null;
  type: string;
  totalEpisodes: number | null;
  airDate: string | null;
  lastSyncedAt: string | null;
  provider: string;
  externalId: string;
  url: string | null;
  episodeCount: number;
  availableSummaries?: AnimeSummary[];
  availableNames?: AnimeName[];
  availablePosters?: AnimePoster[];
};

export type AnimeProgress = {
  id: number;
  status: UserAnimeStatus;
  lastWatchedEpisodeNumber: number | null;
  lastWatchedAt: string | null;
  preferredNameId: number | null;
  preferredSummaryId: number | null;
  preferredPosterId: number | null;
  animeId?: number;
};

export type LibraryProgress = AnimeProgress & {
  watchedEpisodeCount: number;
  totalEpisodeCount: number | null;
  progressPercent: number | null;
};

export type LibraryItem = {
  anime: Anime;
  progress: LibraryProgress;
};

export type NavigationAnchor = {
  key: string;
  label: string;
  offset: number;
  page: number;
};

export type LibraryResponse = {
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
  sort: string;
  order: SortOrder;
  navigationAnchors: NavigationAnchor[];
  items: LibraryItem[];
};

export type Episode = {
  id: number;
  episodeNumber: number;
  name: AnimeName | null;
  displayName: string;
  originalTitle: string;
  airAt: string | null;
  duration: string | null;
  status: string;
  watched: boolean;
  watchedAt: string | null;
  availableNames: AnimeName[];
  preferredNameId: number | null;
};

export type EpisodeListResponse = {
  animeId: number;
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
  episodes: Episode[];
};

export type AnimeDetailResponse = {
  anime: Anime;
  progress: AnimeProgress;
};
