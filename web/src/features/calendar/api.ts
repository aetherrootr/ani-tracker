import { apiFetch } from "@/lib/api-client";

import type { AiringCalendarResponse } from "./types";

export async function getAiringCalendar(signal?: AbortSignal) {
  const response = await apiFetch<AiringCalendarResponse>("/api/anime/airing-calendar", {
    signal,
    cache: "no-store",
  });

  if (process.env.NODE_ENV !== "production") {
    const animeIds = response.days.flatMap((day) => day.items.map((item) => item.anime.id));
    if (new Set(animeIds).size !== animeIds.length) {
      throw new Error("Duplicate anime in airing calendar response");
    }
    for (const item of response.days.flatMap((day) => day.items)) {
      const episodeIds = item.episodes.map((episode) => episode.id);
      if (new Set(episodeIds).size !== episodeIds.length) {
        throw new Error("Duplicate episode in airing calendar response");
      }
    }
  }

  return response;
}
