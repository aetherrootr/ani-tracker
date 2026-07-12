"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { getCurrentTvtimeImportJob, getTvtimeImportJob, getTvtimeReportUrl, TvtimeImportApiError, type TvtimeImportJob, uploadTvtimeImport } from "@/features/imports/tvtime";

const BOOLEAN_OPTIONS = ["true", "false"] as const;
const WORKER_OPTIONS = ["1", "2", "3", "4", "5"] as const;

export function TvtimeImportCard() {
  const t = useTranslations();
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<(typeof BOOLEAN_OPTIONS)[number]>("true");
  const [includeFollowed, setIncludeFollowed] = useState<(typeof BOOLEAN_OPTIONS)[number]>("true");
  const [tvdbWorkers, setTvdbWorkers] = useState<(typeof WORKER_OPTIONS)[number]>("2");
  const [job, setJob] = useState<TvtimeImportJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingJob, setIsLoadingJob] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentTvtimeImportJob(controller.signal)
      .then((currentJob) => {
        setJob(currentJob);
        if (currentJob?.status === "queued" || currentJob?.status === "running") {
          setIsExpanded(true);
        }
      })
      .catch(() => undefined)
      .finally(() => setIsLoadingJob(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      getTvtimeImportJob(job.jobId, controller.signal)
        .then(setJob)
        .catch(() => undefined);
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function handleSubmit() {
    if (!file) {
      setError(t("settings.import.tvtime.missingFile"));
      return;
    }
    setIsUploading(true);
    setError(null);
    setIsExpanded(true);
    setJob({
      jobId: "pending",
      status: "running",
      progress: { stage: "uploading", processed: 0, total: 1, percent: 5, message: t("settings.import.tvtime.uploading") },
      summary: null,
      backend: "tvdb",
      dryRun: dryRun === "true",
      reportUrl: "",
    });
    try {
      const nextJob = await uploadTvtimeImport({ file, dryRun: dryRun === "true", includeFollowed: includeFollowed === "true", tvdbWorkers: Number(tvdbWorkers) });
      setJob(nextJob);
    } catch (exc) {
      if (exc instanceof TvtimeImportApiError && exc.job) {
        setJob(exc.job);
      } else {
        setJob(null);
      }
      setError(exc instanceof Error ? exc.message : t("settings.import.tvtime.failed"));
    } finally {
      setIsUploading(false);
    }
  }

  const progress = job?.progress;
  const summary = job?.summary;
  const hasActiveJob = job?.status === "queued" || job?.status === "running";
  const needsManualReview = Boolean((summary?.unresolvedRecords ?? 0) > 0 || (summary?.providerFailures ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{t("settings.import.tvtime.title")}</CardTitle>
        <Button type="button" variant="outline" onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? t("settings.import.tvtime.collapse") : t("settings.import.tvtime.expand")}
        </Button>
      </CardHeader>
      {isExpanded ? <CardContent className="space-y-5 text-sm leading-6 text-muted-foreground">
        <p>{t("settings.import.tvtime.description")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tvtime-file">{t("settings.import.tvtime.file")}</Label>
            <Input id="tvtime-file" type="file" accept=".zip,.csv,text/csv,application/zip" disabled={hasActiveJob} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2">
            <Label>{t("settings.import.tvtime.backend")}</Label>
            <div className="rounded-md border bg-secondary px-3 py-2 font-medium text-secondary-foreground">TVDB</div>
          </div>
          <div className="space-y-2">
            <Label>{t("settings.import.tvtime.dryRun")}</Label>
            <SlidingOptionGroup options={BOOLEAN_OPTIONS} value={dryRun} render={(value) => t(`settings.import.tvtime.boolean.${value}`)} onChange={setDryRun} />
          </div>
          <div className="space-y-2">
            <Label>{t("settings.import.tvtime.includeFollowed")}</Label>
            <SlidingOptionGroup options={BOOLEAN_OPTIONS} value={includeFollowed} render={(value) => t(`settings.import.tvtime.boolean.${value}`)} onChange={setIncludeFollowed} />
          </div>
          <div className="space-y-2">
            <Label>{t("settings.import.tvtime.workers")}</Label>
            <SlidingOptionGroup options={WORKER_OPTIONS} value={tvdbWorkers} render={(value) => value} onChange={setTvdbWorkers} />
          </div>
        </div>
        <Button onClick={handleSubmit} disabled={isUploading || isLoadingJob || hasActiveJob}>{hasActiveJob ? t("settings.import.tvtime.running") : isUploading ? t("settings.import.tvtime.importing") : t("settings.import.tvtime.start")}</Button>
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p> : null}
        {progress ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-foreground">{t(`settings.import.tvtime.stages.${progress.stage}`)}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <p>{progress.message}</p>
          </div>
        ) : null}
        {summary ? (
          <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={t("settings.import.tvtime.summary.importedAnime")} value={summary.importedAnime ?? 0} />
            <Metric label={t("settings.import.tvtime.summary.episodes")} value={(summary.importedEpisodeProgress ?? 0) + (summary.updatedEpisodeProgress ?? 0)} />
            <Metric label={t("settings.import.tvtime.summary.duplicates")} value={summary.skippedDuplicates ?? 0} />
            <Metric label={t("settings.import.tvtime.summary.unresolved")} value={summary.unresolvedRecords ?? 0} />
          </div>
        ) : null}
        {needsManualReview ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">{t("settings.import.tvtime.manualReview")}</p> : null}
        {job && job.jobId !== "pending" ? (
          <Button variant="outline" onClick={() => window.location.assign(getTvtimeReportUrl(job.jobId))}>{t("settings.import.tvtime.downloadReport")}</Button>
        ) : null}
      </CardContent> : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}
