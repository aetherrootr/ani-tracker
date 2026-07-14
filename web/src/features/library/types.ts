export type UserAnimeStatus = "plan_to_watch" | "watching" | "completed" | "on_hold" | "dropped";

export type LibraryStatusFilter = "all" | Exclude<UserAnimeStatus, "dropped">;
export type LibraryListFilter = "all" | "tracking" | "backlog";
export type LibrarySeasonZeroFilter = "include" | "exclude" | "only";
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
  relatedAnime?: RelatedAnime[];
};

export type RelatedAnime = {
  provider: string;
  externalId: string;
  animeId: number | null;
  inLibrary: boolean;
  title: string;
  relationType: string;
  seasonNumber: number | null;
  airDate: string | null;
  episodeCount: number | null;
  url: string | null;
  posterUrl: string | null;
  source?: "provider" | "fallback" | "manual";
  mappedByOverride?: boolean;
  needsManualMapping?: boolean;
  pendingUpstreamDeletion?: boolean;
  relationId?: number | null;
  manualRelationId?: number | null;
  deletionPromptId?: number;
  allowProviderImport?: boolean | null;
};

export type ManualRelatedAnime = {
  id: number;
  animeId: number;
  relatedAnimeId: number;
  relatedAnimeTitle: string;
  relationType: string;
  note: string | null;
  createdFromAnimeRelationId: number | null;
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
  providers: ImportProvider[];
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
  features?: {
    seasonDiscovery: boolean;
  };
};

export type EpisodeConflict = {
  animeId: number;
  episodeId: number;
  episodeNumber: number;
  displayName?: string | null;
  watchedUserCount?: number;
  watched?: boolean;
  watchedAt?: string | null;
  reason?: string | null;
};

export type AnimeSyncResponse = {
  anime: Anime;
  progress: AnimeProgress;
  synced: boolean;
  episodeConflicts: EpisodeConflict[];
};

export type RelatedAnimeDiscoveryResponse = {
  checked: boolean;
  skippedReason: string | null;
  importedAnimeIds: number[];
  existingAnimeIds: number[];
  postersQueued: number;
};

export type LibraryRefreshProgress = {
  stage: string;
  processed: number;
  total: number;
  percent: number;
  message: string;
  details?: {
    processed: number;
    total: number;
    currentAnime?: { animeId: number; title: string };
    checked?: number;
    synced?: number;
    failed: number;
    episodeConflicts?: number;
    imported?: number;
    existing?: number;
    skipped?: number;
    postersQueued: number;
    failedAnime?: LibraryRefreshFailedAnime[];
  };
};

export type LibraryRefreshFailedAnime = {
  animeId: number;
  title: string;
  error?: string;
};

export type LibraryRefreshJob = {
  jobId: string;
  status: "completed" | "failed" | "running" | "queued";
  progress: LibraryRefreshProgress | null;
  summary: Record<string, unknown> | null;
  retryFailedOnly?: boolean;
};

export type LibraryRefreshResponse = {
  queued: boolean;
  taskId: string;
  job: LibraryRefreshJob | null;
};

export type RelatedAnimeDiscoveryJobResponse = LibraryRefreshResponse;

export type ResolveEpisodeConflictsResponse = {
  anime: Anime;
  progress: AnimeProgress;
  resolution: {
    deletedEpisodeIds: number[];
    keptEpisodeIds: number[];
    invalidEpisodeIds: number[];
  };
};

export type TrackingListItem = {
  anime: Anime;
  progress: AnimeProgress;
  episode: Episode;
  watchedEpisodeCount: number;
  airedEpisodeCount: number;
  totalEpisodeCount: number | null;
};

export type TrackingListPage<TItem> = {
  items: TItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type TrackingListResponse = {
  tracking: TrackingListPage<TrackingListItem>;
  backlog: TrackingListPage<TrackingListItem>;
  recentlyWatched: TrackingListPage<TrackingListItem>;
};

export type ImportProvider = {
  name: string;
  label: string;
};

export type ImportProvidersResponse = {
  providers: ImportProvider[];
};

export type ProviderSwitchResponse = {
  anime: Anime;
  progress: AnimeProgress;
  previousAnimeId: number;
  episodeConflicts: EpisodeConflict[];
  relatedAnimeMode?: "provider" | "fallback" | "none";
  autoMappedCount?: number;
  manualMappingRequiredCount?: number;
  fallbackRelationCount?: number;
};
