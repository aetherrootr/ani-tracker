"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, FileArchive, ShieldCheck, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/library/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { getCurrentTvtimeImportJob, getTvtimeImportJob, getTvtimeReportUrl, type TvtimeImportJob, uploadTvtimeImport } from "@/features/imports/tvtime";

const WORKER_OPTIONS = ["1", "2", "3", "4", "5"] as const;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function TvtimeImportCard() {
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [includeFollowed, setIncludeFollowed] = useState(true);
  const [includeSpecials, setIncludeSpecials] = useState(true);
  const [tvdbWorkers, setTvdbWorkers] = useState<(typeof WORKER_OPTIONS)[number]>("2");
  const [job, setJob] = useState<TvtimeImportJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingJob, setIsLoadingJob] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentTvtimeImportJob(controller.signal)
      .then((currentJob) => {
        setJob(currentJob);
        if (currentJob?.status === "queued" || currentJob?.status === "running") setIsExpanded(true);
      })
      .catch(() => undefined)
      .finally(() => setIsLoadingJob(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      getTvtimeImportJob(job.jobId, controller.signal).then(setJob).catch(() => undefined);
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function startImport() {
    if (!file) {
      setError(t("settings.import.tvtime.missingFile"));
      requestAnimationFrame(() => fileInputRef.current?.focus());
      return;
    }
    setIsUploading(true);
    setError(null);
    setJob({
      jobId: "pending",
      status: "running",
      progress: { stage: "uploading", processed: 0, total: 1, percent: 5, message: "" },
      summary: null,
      backend: "tvdb",
      dryRun,
      reportUrl: "",
    });
    try {
      setJob(await uploadTvtimeImport({ file, dryRun, includeFollowed, includeSpecials, tvdbWorkers: Number(tvdbWorkers) }));
    } catch {
      setJob(null);
      setError(t("settings.import.tvtime.failed"));
    } finally {
      setIsUploading(false);
    }
  }

  function handleStart() {
    if (!file) {
      setError(t("settings.import.tvtime.missingFile"));
      requestAnimationFrame(() => fileInputRef.current?.focus());
    } else if (dryRun) {
      void startImport();
    } else {
      setConfirmOpen(true);
    }
  }

  const progress = job?.progress;
  const summary = job?.summary;
  const hasActiveJob = job?.status === "queued" || job?.status === "running";
  const completed = job?.status === "completed";
  const failed = job?.status === "failed";
  const needsManualReview = Boolean((summary?.unresolvedRecords ?? 0) > 0 || (summary?.providerFailures ?? 0) > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>{t("settings.import.tvtime.title")}</CardTitle>
          <p className="text-sm font-normal leading-6 text-muted-foreground">{t("settings.import.tvtime.summaryDescription")}</p>
        </div>
        <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11 flex-none" aria-label={isExpanded ? t("settings.import.tvtime.collapse") : t("settings.import.tvtime.expand")} aria-expanded={isExpanded} aria-controls="tvtime-import-panel" onClick={() => setIsExpanded((current) => !current)}>
          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </Button>
      </CardHeader>

      {isExpanded ? (
        <CardContent id="tvtime-import-panel" className="space-y-6 text-sm leading-6 text-muted-foreground">
          <section className="import-step" aria-labelledby="tvtime-file-step">
            <StepHeading number="1" id="tvtime-file-step" title={t("settings.import.tvtime.fileStep")} />
            <div className="flex items-start gap-3 rounded-[var(--radius-control)] bg-[var(--accent-soft)] p-3.5">
              <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-[var(--accent-solid)]" aria-hidden="true" />
              <p>{t("settings.import.tvtime.privacy")}</p>
            </div>
            <input
              ref={fileInputRef}
              id="tvtime-file"
              className="sr-only"
              type="file"
              accept=".zip,.csv,text/csv,application/zip"
              disabled={hasActiveJob}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                if (nextFile && nextFile.size > MAX_FILE_SIZE) {
                  setFile(null);
                  event.target.value = "";
                  setError(t("settings.import.tvtime.fileTooLarge"));
                } else {
                  setFile(nextFile);
                  setError(null);
                }
              }}
            />
            {file ? (
              <div className="flex min-h-16 items-center gap-3 rounded-[var(--radius-control)] border bg-[var(--surface-card)] p-3">
                <FileArchive className="h-6 w-6 flex-none text-[var(--accent-solid)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{file.name}</p>
                  <p className="text-xs">{formatFileSize(file.size)}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("settings.import.tvtime.removeFile")} disabled={hasActiveJob} onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="min-h-11" disabled={hasActiveJob} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {t("settings.import.tvtime.chooseFile")}
              </Button>
            )}
            <p className="text-xs">{t("settings.import.tvtime.fileHelp")}</p>
          </section>

          <section className="import-step" aria-labelledby="tvtime-options-step">
            <StepHeading number="2" id="tvtime-options-step" title={t("settings.import.tvtime.scopeStep")} />
            <div className="divide-y overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface-card)]">
              <ImportSwitch label={t("settings.import.tvtime.dryRun")} description={t("settings.import.tvtime.dryRunDescription")} checked={dryRun} disabled={hasActiveJob} onChange={setDryRun} />
              <ImportSwitch label={t("settings.import.tvtime.includeFollowed")} description={t("settings.import.tvtime.includeFollowedDescription")} checked={includeFollowed} disabled={hasActiveJob} onChange={setIncludeFollowed} />
              <ImportSwitch label={t("settings.import.tvtime.includeSpecials")} description={t("settings.import.tvtime.includeSpecialsDescription")} checked={includeSpecials} disabled={hasActiveJob} onChange={setIncludeSpecials} />
            </div>
            <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-[var(--radius-control)] px-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" aria-expanded={advancedOpen} aria-controls="tvtime-advanced-options" onClick={() => setAdvancedOpen((current) => !current)}>
              {t("settings.import.tvtime.advanced")}
              <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {advancedOpen ? (
              <div id="tvtime-advanced-options" className="max-w-xs rounded-[var(--radius-control)] bg-secondary p-3">
                <SelectField label={t("settings.import.tvtime.workers")} value={tvdbWorkers} options={WORKER_OPTIONS.map((value) => ({ value, label: value }))} disabled={hasActiveJob} onValueChange={setTvdbWorkers} />
                <p className="px-1 text-xs">{t("settings.import.tvtime.workersDescription")}</p>
              </div>
            ) : null}
          </section>

          <section className="import-step" aria-labelledby="tvtime-run-step">
            <StepHeading number="3" id="tvtime-run-step" title={t("settings.import.tvtime.runStep")} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>{dryRun ? t("settings.import.tvtime.previewReady") : t("settings.import.tvtime.applyWarning")}</p>
              <Button className="min-h-11 flex-none" onClick={handleStart} disabled={isUploading || isLoadingJob || hasActiveJob || !file}>
                {hasActiveJob ? t("settings.import.tvtime.running") : isUploading ? t("settings.import.tvtime.importing") : dryRun ? t("settings.import.tvtime.preview") : t("settings.import.tvtime.apply")}
              </Button>
            </div>
          </section>

          {error ? <p role="alert" className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-destructive">{error}</p> : null}

          {progress && hasActiveJob ? (
            <div className="space-y-3 rounded-[var(--radius-card)] border p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-foreground">{stageLabel(progress.stage, t)}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={stageLabel(progress.stage, t)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                <div className="library-refresh-progress h-full bg-[var(--accent-solid)]" style={{ width: `${progress.percent}%` }} />
              </div>
              <p>{t("settings.import.tvtime.backgroundNotice")}</p>
            </div>
          ) : null}

          {completed ? (
            <div role="status" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--watched)_28%,transparent)] bg-[color-mix(in_srgb,var(--watched)_10%,var(--surface-card))] p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[var(--watched)]" aria-hidden="true" />
              <div><p className="font-medium text-foreground">{job.dryRun ? t("settings.import.tvtime.previewCompleted") : t("settings.import.tvtime.importCompleted")}</p><p>{t("settings.import.tvtime.reviewResult")}</p></div>
            </div>
          ) : null}
          {failed ? <p role="alert" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-4 text-destructive"><AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" /><span>{t("settings.import.tvtime.failed")}</span></p> : null}

          {summary ? <ImportSummary summary={summary} /> : null}
          {needsManualReview ? <p className="flex items-start gap-3 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" /><span>{t("settings.import.tvtime.manualReview")}</span></p> : null}
          {job && job.jobId !== "pending" && !hasActiveJob ? <Button variant="outline" className="min-h-11" onClick={() => window.location.assign(getTvtimeReportUrl(job.jobId))}>{t("settings.import.tvtime.downloadReport")}</Button> : null}
        </CardContent>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("settings.import.tvtime.confirmTitle")}
        description={t("settings.import.tvtime.confirmDescription")}
        confirmLabel={t("settings.import.tvtime.apply")}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void startImport();
        }}
      />
    </Card>
  );
}

function StepHeading({ number, id, title }: { number: string; id: string; title: string }) {
  return <h3 id={id} className="flex items-center gap-2.5 text-base font-semibold text-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs text-[var(--accent-solid)]" aria-hidden="true">{number}</span>{title}</h3>;
}

function ImportSwitch({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex min-h-20 items-center justify-between gap-4 p-4">
      <div className="min-w-0"><p className="font-medium text-foreground">{label}</p><p>{description}</p></div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className="settings-switch flex-none" onClick={() => onChange(!checked)}><span aria-hidden="true" /></button>
    </div>
  );
}

function ImportSummary({ summary }: { summary: NonNullable<TvtimeImportJob["summary"]> }) {
  const t = useTranslations();
  return (
    <dl className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border bg-[var(--divider)] sm:grid-cols-2 lg:grid-cols-4">
      <Metric label={t("settings.import.tvtime.summary.importedAnime")} value={summary.importedAnime ?? 0} />
      <Metric label={t("settings.import.tvtime.summary.episodes")} value={(summary.importedEpisodeProgress ?? 0) + (summary.updatedEpisodeProgress ?? 0)} />
      <Metric label={t("settings.import.tvtime.summary.duplicates")} value={summary.skippedDuplicates ?? 0} />
      <Metric label={t("settings.import.tvtime.summary.unresolved")} value={summary.unresolvedRecords ?? 0} />
    </dl>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="flex flex-col bg-[var(--surface-card)] p-4"><dt className="order-2 mt-1 text-xs font-medium text-muted-foreground">{label}</dt><dd className="order-1 text-2xl font-semibold text-foreground">{value}</dd></div>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stageLabel(stage: string, t: ReturnType<typeof useTranslations>) {
  const knownStages = ["queued", "uploading", "parsing", "importing_metadata", "writing_progress", "generating_report", "completed", "failed"] as const;
  const known = knownStages.find((candidate) => candidate === stage);
  return known ? t(`settings.import.tvtime.stages.${known}`) : t("settings.import.tvtime.processing");
}
