export type AiringCalendarEpisode = {
  id: number;
  episodeNumber: number;
  displayName: string | null;
  airAt: string;
  airAtPrecision: "date" | "datetime";
  status: string;
  watched: boolean;
};

export type AiringCalendarItem = {
  anime: {
    id: number;
    displayName: string;
    originalName: string;
    posterUrl: string | null;
  };
  episodeCount: number;
  watchedEpisodeCount: number;
  minimumEpisodeTitle: string | null;
  episodesTruncated: boolean;
  scheduleSummary: {
    earliestExactAirAt: string | null;
    exactTimeSlotCount: number;
    hasDatePrecision: boolean;
  };
  episodes: AiringCalendarEpisode[];
};

export type AiringCalendarDay = {
  date: string;
  items: AiringCalendarItem[];
};

export type AiringCalendarResponse = {
  startDate: string;
  endDate: string;
  todayDate: string;
  weekStartDate: string;
  weekEndDate: string;
  timeZone: string;
  generatedAt: string;
  totalAnimeCount: number;
  days: AiringCalendarDay[];
};
