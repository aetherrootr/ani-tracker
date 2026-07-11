export type StatisticsDay = {
  date: string;
  watchedEpisodeCount: number;
  watchSeconds: number;
};

export type StatisticsWeek = {
  weekStartDate: string;
  weekEndDate: string;
  watchedEpisodeCount: number;
  watchSeconds: number;
};

export type StatisticsSummary = {
  status: "ready" | "pending" | "failed";
  watchedEpisodeCount: number;
  unwatchedAiredEpisodeCount: number;
  libraryAnimeCount: number;
  totalWatchSeconds: number;
  averageWeeklyWatchedEpisodesLastQuarter: number;
  weekStartDay: number;
  daily: StatisticsDay[];
  weekly: StatisticsWeek[];
  message?: string;
};

export type WatchTimelineItem = {
  anime: {
    id: number;
    displayName: string;
    posterUrl: string | null;
  };
  episode: {
    id: number;
    episodeNumber: number;
    displayName: string | null;
    duration: string | null;
    durationSeconds: number | null;
    watchedAt: string | null;
  };
};

export type WatchTimelinePage = {
  items: WatchTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};
