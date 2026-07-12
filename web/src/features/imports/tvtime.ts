import { getApiUrl } from "@/lib/api-client";

export type TvtimeImportSummary = {
  parsedRecords?: number;
  uniqueWatchedRecords?: number;
  animeSeasonsQueued?: number;
  importedAnime?: number;
  importedEpisodeProgress?: number;
  updatedEpisodeProgress?: number;
  skippedDuplicates?: number;
  providerFailures?: number;
  unresolvedRecords?: number;
  extraWatchEvents?: number;
  existingDataPreserved?: number;
  libraryEntriesImported?: number;
};

export type TvtimeImportProgress = {
  stage: string;
  processed: number;
  total: number;
  percent: number;
  message: string;
};

export type TvtimeImportJob = {
  jobId: string;
  status: "completed" | "failed" | "running" | "queued";
  progress: TvtimeImportProgress | null;
  summary: TvtimeImportSummary | null;
  backend: string;
  dryRun: boolean;
  reportUrl: string;
};

export class TvtimeImportApiError extends Error {
  status: number;
  job: TvtimeImportJob | null;

  constructor(message: string, status: number, job: TvtimeImportJob | null) {
    super(message);
    this.name = "TvtimeImportApiError";
    this.status = status;
    this.job = job;
  }
}

export async function getCurrentTvtimeImportJob(signal?: AbortSignal): Promise<TvtimeImportJob | null> {
  const response = await fetchJson<{ job: TvtimeImportJob | null }>("/api/import/tvtime", { signal });
  return response.job;
}

export async function uploadTvtimeImport(params: {
  file: File;
  dryRun: boolean;
  includeFollowed: boolean;
  includeSpecials: boolean;
  tvdbWorkers: number;
}): Promise<TvtimeImportJob> {
  const form = new FormData();
  form.append("file", params.file);
  form.append("backend", "tvdb");
  form.append("dryRun", String(params.dryRun));
  form.append("includeFollowed", String(params.includeFollowed));
  form.append("includeSpecials", String(params.includeSpecials));
  form.append("tvdbWorkers", String(params.tvdbWorkers));

  return fetchJson("/api/import/tvtime", { method: "POST", body: form });
}

export async function getTvtimeImportJob(jobId: string, signal?: AbortSignal): Promise<TvtimeImportJob> {
  return fetchJson(`/api/import/tvtime/${jobId}`, { signal });
}

export function getTvtimeReportUrl(jobId: string) {
  return getApiUrl(`/api/import/tvtime/${jobId}/report`);
}

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(getApiUrl(path), { ...options, credentials: "include" });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let job: TvtimeImportJob | null = null;
    try {
      const body = (await response.json()) as { message?: string; job?: TvtimeImportJob | null };
      if (body.message) {
        message = body.message;
      }
      job = body.job ?? null;
    } catch {
      // Keep the status-based message.
    }
    throw new TvtimeImportApiError(message, response.status, job);
  }
  return (await response.json()) as T;
}
