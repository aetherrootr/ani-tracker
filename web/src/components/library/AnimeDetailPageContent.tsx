"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Repeat2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assetUrl, createManualRelatedAnime, deleteManualRelatedAnime, dismissDeletedRelatedAnime, discoverRelatedAnime, getAnimeDetail, getCurrentRelatedAnimeDiscoveryJob, getLibrary, getManualRelatedAnime, getRelatedAnimeDiscoveryJob, keepDeletedRelatedAnime, syncAnime, updateAnimeStatus, updateManualRelatedAnime, updateMetadataSource, updateRelatedAnimeOverride, updateRelatedAnimeProviderImport } from "@/features/library/api";
import { useAnimeDetail } from "@/features/library/hooks";
import type { Anime, AnimeProgress, EpisodeConflict, LibraryItem, LibraryRefreshJob, ManualRelatedAnime, RelatedAnime, RelatedAnimeDiscoveryResponse, UserAnimeStatus } from "@/features/library/types";
import { addSearchResultToLibrary } from "@/features/search/api";
import type { DuplicateAnimeConflict, DuplicateResolution } from "@/features/search/types";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { AnimeHeroSettingsMenu } from "./AnimeHeroSettingsMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeList } from "./EpisodeList";
import { SkeletonBlock } from "./LibraryPagination";
import { NoPoster } from "./NoPoster";
import { ProviderSwitchDialog } from "./ProviderSwitchDialog";

const STATUS_OPTIONS: UserAnimeStatus[] = ["plan_to_watch", "watching", "completed", "on_hold", "dropped"];
const POSTER_POLL_INTERVAL_MS = 1200;
const POSTER_POLL_ATTEMPTS = 10;
const DISCOVERY_JOB_POLL_INTERVAL_MS = 1200;
const DISCOVERY_JOB_POLL_ATTEMPTS = 150;
const RELATED_ANIME_DISCOVERY_BY_PROVIDER = {
  bangumi: discoverRelatedAnime,
  tvdb: discoverRelatedAnime,
} as const;
const RELATED_ANIME_DISCOVERY_MESSAGES = {
  imported: "library.relatedAnimeDiscoveryImported",
  noNew: "library.relatedAnimeDiscoveryNoNew",
  skippedByStatus: "library.relatedAnimeDiscoverySkippedByStatus",
} as const;

export function AnimeDetailPageContent({ animeId }: { animeId: number }) {
  const t = useTranslations();
  const router = useRouter();
  const { data, setData, isLoading, error, retry } = useAnimeDetail(animeId);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const posterPollingAnimeIdRef = useRef<number | null>(null);
  const relatedDiscoveryJobIdRef = useRef<string | null>(null);
  const [dropConfirm, setDropConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDiscoveringSeasons, setIsDiscoveringSeasons] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [seasonDiscoveryMessage, setSeasonDiscoveryMessage] = useState<string | null>(null);
  const [episodeRefreshKey, setEpisodeRefreshKey] = useState(0);
  const [episodeConflicts, setEpisodeConflicts] = useState<EpisodeConflict[]>([]);
  const [isPosterRefreshing, setIsPosterRefreshing] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [providerSwitchOpen, setProviderSwitchOpen] = useState(false);
  const [manualRelatedOpen, setManualRelatedOpen] = useState(false);

  const applyRelatedAnimeDiscoveryJob = useCallback(async (job: LibraryRefreshJob) => {
    const result = relatedAnimeDiscoverySummary(job.summary);
    if (!result) {
      throw new Error(t("library.relatedAnimeDiscoveryFailed"));
    }
    const refreshed = await getAnimeDetail(animeId);
    setData(refreshed);
    setEpisodeRefreshKey((current) => current + 1);
    if (result.skippedReason === "related_status_not_eligible") {
      setSeasonDiscoveryMessage(t(RELATED_ANIME_DISCOVERY_MESSAGES.skippedByStatus));
    } else if (result.importedAnimeIds.length > 0) {
      setSeasonDiscoveryMessage(t(RELATED_ANIME_DISCOVERY_MESSAGES.imported, { count: result.importedAnimeIds.length }));
    } else {
      setSeasonDiscoveryMessage(t(RELATED_ANIME_DISCOVERY_MESSAGES.noNew));
    }
  }, [animeId, setData, t]);

  useEffect(() => {
    if (!summaryDialogOpen) {
      return;
    }

    document.documentElement.classList.add("dialog-scroll-lock");
    document.body.classList.add("dialog-scroll-lock");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSummaryDialogOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.documentElement.classList.remove("dialog-scroll-lock");
      document.body.classList.remove("dialog-scroll-lock");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [summaryDialogOpen]);

  useEffect(() => {
    if (!statusMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (statusMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setStatusMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setStatusMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!data || data.anime.posterStatus !== "pending" || posterPollingAnimeIdRef.current === animeId) {
      return;
    }
    let cancelled = false;
    posterPollingAnimeIdRef.current = animeId;
    waitForPosterRefresh(animeId)
      .then((refreshed) => {
        if (cancelled || refreshed === null) {
          return;
        }
        setData((current) => current ? { ...current, anime: refreshed.anime, progress: refreshed.progress } : current);
      })
      .finally(() => {
        if (posterPollingAnimeIdRef.current === animeId) {
          posterPollingAnimeIdRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [animeId, data, setData]);

  useEffect(() => {
    if (!data || !data.features?.seasonDiscovery || !RELATED_ANIME_DISCOVERY_BY_PROVIDER[data.anime.provider as keyof typeof RELATED_ANIME_DISCOVERY_BY_PROVIDER] || isDiscoveringSeasons) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    getCurrentRelatedAnimeDiscoveryJob(animeId, controller.signal)
      .then((job) => {
        if (cancelled || !job || !["queued", "running"].includes(job.status) || relatedDiscoveryJobIdRef.current === job.jobId) {
          return;
        }
        relatedDiscoveryJobIdRef.current = job.jobId;
        setIsDiscoveringSeasons(true);
        setSyncError(null);
        setSeasonDiscoveryMessage(null);
        return waitForRelatedAnimeDiscovery(animeId, job.jobId)
          .then((completedJob) => {
            if (!cancelled) {
              return applyRelatedAnimeDiscoveryJob(completedJob);
            }
          })
          .catch((err: unknown) => {
            if (!cancelled) {
              setSyncError(err instanceof Error ? err.message : t("library.relatedAnimeDiscoveryFailed"));
            }
          })
          .finally(() => {
            if (!cancelled) {
              relatedDiscoveryJobIdRef.current = null;
              setIsDiscoveringSeasons(false);
            }
          });
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setSyncError(err instanceof Error ? err.message : t("library.relatedAnimeDiscoveryFailed"));
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [animeId, applyRelatedAnimeDiscoveryJob, data, isDiscoveringSeasons, t]);

  async function setStatus(status: UserAnimeStatus) {
    if (!data || status === data.progress.status) {
      return;
    }
    if (status === "dropped") {
      setDropConfirm(true);
      return;
    }
    const result = await updateAnimeStatus(animeId, status);
    updateProgress(result.progress);
  }

  function updateProgress(progress: AnimeProgress) {
    setData((current) => current ? { ...current, progress } : current);
  }

  function updateAnime(anime: Anime) {
    setData((current) => current ? { ...current, anime } : current);
  }

  async function refreshDetail() {
    const refreshed = await getAnimeDetail(animeId);
    setData(refreshed);
  }

  async function syncCurrentAnime() {
    if (isSyncing) {
      return;
    }
    setIsSyncing(true);
    setSyncError(null);
    try {
      const result = await syncAnime(animeId);
      const needsPosterPolling = result.anime.posterStatus === "pending";
      setData((current) => current ? {
        ...current,
        anime: needsPosterPolling ? keepCurrentPoster(result.anime, current.anime) : result.anime,
        progress: result.progress,
      } : current);
      setEpisodeRefreshKey((current) => current + 1);
      setEpisodeConflicts(result.episodeConflicts);
      if (needsPosterPolling) {
        setIsPosterRefreshing(true);
        const refreshed = await waitForPosterRefresh(animeId);
        if (refreshed !== null) {
          setData((current) => current ? { ...current, anime: refreshed.anime, progress: refreshed.progress } : current);
        }
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t("library.syncFailed"));
    } finally {
      setIsPosterRefreshing(false);
      setIsSyncing(false);
    }
  }

  async function discoverSeasons() {
    const discoverRelatedAnime = data ? RELATED_ANIME_DISCOVERY_BY_PROVIDER[data.anime.provider as keyof typeof RELATED_ANIME_DISCOVERY_BY_PROVIDER] : undefined;
    if (!data || !discoverRelatedAnime || isDiscoveringSeasons) {
      return;
    }
    setIsDiscoveringSeasons(true);
    setSyncError(null);
    setSeasonDiscoveryMessage(null);
    try {
      const queued = await discoverRelatedAnime(animeId);
      relatedDiscoveryJobIdRef.current = queued.taskId;
      const job = await waitForRelatedAnimeDiscovery(animeId, queued.taskId);
      await applyRelatedAnimeDiscoveryJob(job);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t("library.relatedAnimeDiscoveryFailed"));
    } finally {
      relatedDiscoveryJobIdRef.current = null;
      setIsDiscoveringSeasons(false);
    }
  }

  async function activateLocalSnapshotFromConflict() {
    setSyncError(null);
    try {
      const result = await updateMetadataSource(animeId, "local_snapshot");
      setData((current) => current ? { ...current, anime: result.anime, progress: result.progress, metadataSnapshot: result.metadataSnapshot, episodeConflicts: [] } : current);
      setEpisodeConflicts([]);
      setEpisodeRefreshKey((current) => current + 1);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t("library.switchProviderFailed"));
    }
  }

  if (isLoading) {
    return <div className="space-y-6"><SkeletonBlock className="h-[420px]" /><SkeletonBlock className="h-48" /></div>;
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <p className="font-medium">{t("library.loadFailed")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button type="button" className="mt-4" onClick={retry}>{t("search.retry")}</Button>
      </div>
    );
  }

  const poster = assetUrl(data.anime.posterUrl);
  const summary = data.anime.summary?.summary?.trim() || t("anime.noSummary");
  const showOriginal = data.anime.originalName !== data.anime.displayName;
  const isLocalSnapshot = data.progress.metadataSource === "local_snapshot";
  const providerDisplayName = isLocalSnapshot ? t("library.localSnapshotProvider") : data.anime.provider;
  const canDiscoverRelatedAnime = Boolean(!isLocalSnapshot && data.features?.seasonDiscovery && RELATED_ANIME_DISCOVERY_BY_PROVIDER[data.anime.provider as keyof typeof RELATED_ANIME_DISCOVERY_BY_PROVIDER]);
  const activeEpisodeConflicts = episodeConflicts.length > 0 ? episodeConflicts : data.episodeConflicts;

  return (
    <div className="space-y-8">
      {data.progress.status === "dropped" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-destructive">{t("library.droppedBanner")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void setStatus("watching")}>{t("library.restoreWatching")}</Button>
            <Link className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent" href="/library">{t("library.backToLibrary")}</Link>
          </div>
        </div>
      ) : null}

      {syncError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium text-destructive">
          {syncError}
        </div>
      ) : null}

      {seasonDiscoveryMessage ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm font-medium text-primary">
          {seasonDiscoveryMessage}
        </div>
      ) : null}

      {activeEpisodeConflicts.length > 0 ? (
        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
          <p className="text-sm font-semibold text-primary">{t("library.syncEpisodeConflictsTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("library.syncEpisodeConflictsDescription", { count: activeEpisodeConflicts.length })}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button type="button" size="sm" onClick={() => void activateLocalSnapshotFromConflict()}>{t("library.useLocalSnapshot")}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setProviderSwitchOpen(true)}>{t("library.switchProvider")}</Button>
          </div>
        </div>
      ) : null}

      <section className="relative rounded-3xl border bg-card shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-3xl">
          {poster ? (
            <Image
              key={poster}
              src={poster}
              alt=""
              fill
              unoptimized
              sizes="100vw"
              className="scale-110 object-cover opacity-25 blur-2xl"
            />
          ) : <div className="absolute inset-0 bg-gradient-to-br from-muted to-card" />}
          <div className="absolute inset-0 bg-gradient-to-br from-background/95 via-background/80 to-background/50" />
        </div>

        <div className="relative z-10 grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:p-8">
          <div className="relative mx-auto hidden aspect-[2/3] w-44 overflow-hidden rounded-2xl border bg-muted shadow-2xl sm:block sm:w-full">
            {poster ? (
              <Image
                key={poster}
                src={poster}
                alt={t("anime.coverAlt", { title: data.anime.displayName })}
                fill
                unoptimized
                sizes="220px"
                className="object-cover"
              />
            ) : <NoPoster />}
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="min-w-0 text-3xl font-semibold tracking-tight sm:text-5xl">{data.anime.displayName}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={isSyncing || isLocalSnapshot}
                      onClick={() => void syncCurrentAnime()}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
                      {isSyncing ? t("library.syncing") : t("library.syncAnime")}
                    </Button>
                    {canDiscoverRelatedAnime ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={isDiscoveringSeasons}
                        onClick={() => void discoverSeasons()}
                      >
                        {isDiscoveringSeasons ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        {isDiscoveringSeasons ? t("library.tvdbSeasonDiscovering") : t("library.tvdbSeasonDiscovery")}
                      </Button>
                    ) : null}
                    <span>{isLocalSnapshot ? t("library.localSnapshotActive") : t("library.lastSynced", { time: formatLastSynced(data.anime.lastSyncedAt, t("library.neverSynced")) })}</span>
                    {isPosterRefreshing ? <span>{t("library.posterRefreshing")}</span> : null}
                  </div>
                </div>
                <AnimeHeroSettingsMenu anime={data.anime} onAnimeChange={updateAnime} onManageManualRelated={() => setManualRelatedOpen(true)} />
              </div>
              {showOriginal ? <p className="mt-2 text-muted-foreground">{data.anime.originalName}</p> : null}
            </div>
            <div className="relative mx-auto aspect-[2/3] w-44 overflow-hidden rounded-2xl border bg-muted shadow-2xl sm:hidden">
              {poster ? (
                <Image
                  key={poster}
                  src={poster}
                  alt={t("anime.coverAlt", { title: data.anime.displayName })}
                  fill
                  unoptimized
                  sizes="176px"
                  className="object-cover"
                />
              ) : <NoPoster />}
            </div>
            <button
              type="button"
              className="relative block max-h-28 w-full max-w-3xl overflow-hidden rounded-2xl bg-background/15 p-3 text-left text-xs leading-6 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
              onClick={() => setSummaryDialogOpen(true)}
            >
              <p className="whitespace-pre-wrap">{summary}</p>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background/70 to-transparent" aria-hidden="true" />
            </button>
            <div className="scrollbar-none hidden max-h-32 max-w-3xl overflow-y-auto rounded-2xl bg-background/15 p-3 text-sm leading-6 text-muted-foreground backdrop-blur-sm sm:block">
              <p className="whitespace-pre-wrap">{summary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div ref={statusMenuRef} className="relative z-20 rounded-2xl border bg-background/35 p-3 backdrop-blur">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  aria-expanded={statusMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setStatusMenuOpen((current) => !current)}
                >
                  <span>
                    <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("library.statusLabel")}</span>
                    <span className="mt-1 block font-semibold">{t(`library.status.${data.progress.status}`)}</span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", statusMenuOpen && "rotate-180")} />
                </button>
                {statusMenuOpen ? (
                  <div className="glass-dialog absolute left-0 top-full z-40 mt-2 w-40 max-w-full overflow-hidden rounded-2xl border p-1 text-foreground sm:w-44" role="menu">
                    {STATUS_OPTIONS.map((status) => {
                      const active = data.progress.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          className={cn(
                            "flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground sm:min-h-11",
                            active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                            status === "dropped" && !active && "text-destructive hover:bg-destructive/10 hover:text-destructive",
                          )}
                          onClick={() => { setStatusMenuOpen(false); void setStatus(status); }}
                        >
                          <span>{t(`library.status.${status}`)}</span>
                          {active ? <Check className="h-4 w-4" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <InfoCard label={t("anime.platform")} value={data.anime.type} />
              <InfoCard label={t("anime.episodes")} value={String(data.anime.totalEpisodes ?? data.anime.episodeCount)} />
              <InfoCard label={t("anime.airDate")} value={data.anime.airDate ?? t("anime.unknown")} />
              <button type="button" className="group relative rounded-2xl border bg-background/35 p-3 text-left backdrop-blur transition-colors hover:bg-background/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setProviderSwitchOpen(true)}>
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</span>
                <span className="mt-1 flex items-center justify-between gap-3 font-semibold">
                  <span>{providerDisplayName}</span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background/60 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary" aria-hidden="true">
                    <Repeat2 className="h-4 w-4" />
                  </span>
                </span>
                <span className="glass-dialog pointer-events-none absolute left-3 top-full z-30 mt-2 hidden w-52 rounded-2xl border p-3 text-foreground shadow-lg group-hover:block group-focus-visible:block">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Repeat2 className="h-4 w-4 text-primary" />
                    {t("library.switchProvider")}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t("library.switchProviderHint")}</span>
                </span>
              </button>
              {data.anime.url ? (
                <a className="rounded-2xl border bg-background/35 p-3 backdrop-blur transition-colors hover:bg-background/55" href={data.anime.url} target="_blank" rel="noreferrer">
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("anime.viewOnProvider", { provider: providerDisplayName })}</span>
                  <span className="mt-1 inline-flex items-center gap-2 font-semibold">
                    {data.anime.externalId}<ExternalLink className="h-4 w-4" />
                  </span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <RelatedAnimeSection animeId={animeId} provider={providerDisplayName} items={data.anime.relatedAnime ?? []} onRefresh={() => void refreshDetail()} />

      <ManualRelatedAnimeDialog open={manualRelatedOpen} animeId={animeId} currentAnimeTitle={data.anime.displayName} relatedItems={data.anime.relatedAnime ?? []} existingRelatedAnimeIds={(data.anime.relatedAnime ?? []).filter((item) => item.source === "manual" && item.animeId !== null).map((item) => item.animeId as number)} onClose={() => setManualRelatedOpen(false)} onChanged={() => void refreshDetail()} />

      <EpisodeList animeId={animeId} metadataSource={data.progress.metadataSource} refreshKey={episodeRefreshKey} onProgressChange={updateProgress} />

      <ConfirmDialog
        open={dropConfirm}
        title={t("library.confirmDropTitle")}
        description={t("library.confirmDropDescription")}
        danger
        confirmLabel={t("library.status.dropped")}
        onCancel={() => setDropConfirm(false)}
        onConfirm={() => {
          setDropConfirm(false);
          updateAnimeStatus(animeId, "dropped").then((result) => updateProgress(result.progress));
        }}
      />
      <ProviderSwitchDialog
        open={providerSwitchOpen}
        anime={data.anime}
        metadataSource={data.progress.metadataSource}
        metadataSnapshot={data.metadataSnapshot}
        onClose={() => setProviderSwitchOpen(false)}
        onMetadataSourceChanged={(progress, metadataSnapshot) => {
          setData((current) => current ? { ...current, progress, metadataSnapshot } : current);
          setEpisodeConflicts([]);
          setEpisodeRefreshKey((current) => current + 1);
        }}
        onSwitched={(targetAnimeId, _previousAnimeId, conflicts) => {
          void conflicts;
          setProviderSwitchOpen(false);
          router.push(`/library/${targetAnimeId}`);
        }}
      />
      {summaryDialogOpen ? (
        <div
          className="mobile-fixed-below-top-nav fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="summary-dialog-title"
          onClick={() => setSummaryDialogOpen(false)}
        >
          <div
            className="glass-dialog flex max-h-[80svh] w-full flex-col rounded-2xl border text-foreground sm:mx-auto sm:max-w-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <h2 id="summary-dialog-title" className="font-semibold tracking-tight">简介</h2>
              <Button type="button" variant="ghost" size="icon" aria-label={t("library.closeFilters")} onClick={() => setSummaryDialogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm leading-7 text-muted-foreground">
              <p className="whitespace-pre-wrap">{summary}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatLastSynced(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function keepCurrentPoster(nextAnime: Anime, currentAnime: Anime) {
  if (!currentAnime.posterUrl) {
    return nextAnime;
  }
  return {
    ...nextAnime,
    poster: currentAnime.poster,
    posterUrl: currentAnime.posterUrl,
    posterStatus: currentAnime.posterStatus,
    preferredPosterId: currentAnime.preferredPosterId,
  };
}

async function waitForPosterRefresh(animeId: number) {
  for (let index = 0; index < POSTER_POLL_ATTEMPTS; index += 1) {
    await sleep(POSTER_POLL_INTERVAL_MS);
    const detail = await getAnimeDetail(animeId);
    if (detail.anime.posterStatus !== "pending") {
      return detail;
    }
  }
  return null;
}

async function waitForRelatedAnimeDiscovery(animeId: number, jobId: string) {
  for (let index = 0; index < DISCOVERY_JOB_POLL_ATTEMPTS; index += 1) {
    await sleep(DISCOVERY_JOB_POLL_INTERVAL_MS);
    const job = await getRelatedAnimeDiscoveryJob(animeId, jobId);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(typeof job.summary?.message === "string" ? job.summary.message : "Related anime discovery failed");
    }
  }
  throw new Error("Related anime discovery timed out");
}

function relatedAnimeDiscoverySummary(summary: LibraryRefreshJob["summary"]): RelatedAnimeDiscoveryResponse | null {
  if (!summary || !Array.isArray(summary.importedAnimeIds) || !Array.isArray(summary.existingAnimeIds)) {
    return null;
  }
  const checked = summary.checked;
  const skippedReason = summary.skippedReason;
  const postersQueued = summary.postersQueued;
  if (typeof checked !== "boolean" || !(typeof skippedReason === "string" || skippedReason === null) || typeof postersQueued !== "number") {
    return null;
  }
  return {
    checked,
    skippedReason,
    importedAnimeIds: summary.importedAnimeIds.filter((value): value is number => typeof value === "number"),
    existingAnimeIds: summary.existingAnimeIds.filter((value): value is number => typeof value === "number"),
    postersQueued,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background/35 p-3 backdrop-blur">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 block font-semibold">{value}</span>
    </div>
  );
}

function RelatedAnimeSection({ animeId, provider, items, onRefresh }: { animeId: number; provider: string; items: RelatedAnime[]; onRefresh: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RelatedAnime | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isResolvingDeletion, setIsResolvingDeletion] = useState(false);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateAnimeConflict | null>(null);

  function updateScrollHints() {
    const element = scrollRef.current;
    if (!element) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    setCanScrollLeft(element.scrollLeft > 1);
    setCanScrollRight(element.scrollLeft < maxScrollLeft - 1);
  }

  function scrollList(direction: "left" | "right") {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollBy({
      left: (direction === "left" ? -1 : 1) * Math.max(element.clientWidth * 0.42, 180),
      behavior: "smooth",
    });
  }

  function closeDialog() {
    if (isAdding) {
      return;
    }
    setSelectedItem(null);
    setAddError(null);
    setDuplicateConflict(null);
  }

  async function addRelatedToLibrary(item: RelatedAnime, duplicateResolution?: DuplicateResolution) {
    setIsAdding(true);
    setAddError(null);
    try {
      const response = await addSearchResultToLibrary(item.provider, item.externalId, duplicateResolution);
      router.push(`/library/${response.anime.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isDuplicateConflictBody(err.body)) {
        setDuplicateConflict(err.body.conflict);
        return;
      }
      setAddError(err instanceof Error ? err.message : t("library.relatedAnimeAddFailed"));
    } finally {
      setIsAdding(false);
    }
  }

  async function keepRemovedRelation(item: RelatedAnime) {
    if (item.deletionPromptId === undefined) {
      return;
    }
    setIsResolvingDeletion(true);
    setAddError(null);
    try {
      await keepDeletedRelatedAnime(animeId, item.deletionPromptId);
      closeDialog();
      onRefresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsResolvingDeletion(false);
    }
  }

  async function dismissRemovedRelation(item: RelatedAnime) {
    if (item.deletionPromptId === undefined) {
      return;
    }
    setIsResolvingDeletion(true);
    setAddError(null);
    try {
      await dismissDeletedRelatedAnime(animeId, item.deletionPromptId);
      closeDialog();
      onRefresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsResolvingDeletion(false);
    }
  }

  useEffect(() => {
    updateScrollHints();
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [items.length]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-3xl border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("library.relatedAnimeTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("library.relatedAnimeDescription", { provider })}</p>
      </div>
      <div className="relative">
        {canScrollLeft ? (
          <button
            type="button"
            className="absolute inset-y-0 left-0 z-20 flex items-center bg-gradient-to-r from-card/90 to-transparent pl-1 pr-5 sm:pl-2 sm:pr-8"
            aria-label="Scroll related anime left"
            onClick={() => scrollList("left")}
          >
            <ChevronLeft className="h-6 w-6 text-foreground/45 sm:h-7 sm:w-7" />
          </button>
        ) : null}
        {canScrollRight ? (
          <button
            type="button"
            className="absolute inset-y-0 right-0 z-20 flex items-center bg-gradient-to-l from-card/90 to-transparent pl-5 pr-1 sm:pl-8 sm:pr-2"
            aria-label="Scroll related anime right"
            onClick={() => scrollList("right")}
          >
            <ChevronRight className="h-6 w-6 text-foreground/45 sm:h-7 sm:w-7" />
          </button>
        ) : null}
      <div ref={scrollRef} className="scrollbar-none flex gap-3 overflow-x-auto overscroll-x-contain pb-1" onScroll={updateScrollHints}>
        {items.map((item, index) => {
          const key = relatedAnimeItemKey(item, index);
          const poster = assetUrl(item.posterUrl);
          const badges = [
            item.source === "manual" ? t("library.relatedAnimeBadgeManual") : null,
            item.mappedByOverride ? t("library.relatedAnimeBadgeMapped") : null,
            item.pendingUpstreamDeletion ? t("library.relatedAnimeBadgeRemoved") : null,
            item.needsManualMapping ? t("library.relatedAnimeBadgeNeedsMapping") : null,
          ].filter(Boolean);
          const content = (
            <>
              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                {poster ? (
                  <Image src={poster} alt="" fill unoptimized sizes="56px" className="object-cover" />
                ) : <NoPoster />}
              </div>
              <span className="min-w-0">
                <span className="line-clamp-2 block font-medium leading-snug text-foreground">{item.title}</span>
                {badges.length > 0 ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {badges.map((badge) => <Badge key={badge} variant="secondary" className="text-[10px]">{badge}</Badge>)}
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.airDate ?? t("library.relatedAnimeTba")}
                  {item.episodeCount !== null ? ` · ${t("library.relatedAnimeEpisodeCount", { count: item.episodeCount })}` : ""}
                </span>
              </span>
            </>
          );
          const className = "flex min-h-28 w-80 shrink-0 items-center gap-3 rounded-2xl border bg-background/60 p-3 transition-colors hover:bg-accent sm:w-96";
          const cardContent = content;
          if (item.pendingUpstreamDeletion) {
            return <button key={key} type="button" className={`${className} text-left`} onClick={() => setSelectedItem(item)}>{cardContent}</button>;
          }
          if (item.inLibrary && item.animeId !== null) {
            return <div key={key} role="button" tabIndex={0} className={`${className} cursor-pointer`} onClick={() => router.push(`/library/${item.animeId}`)} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/library/${item.animeId}`); }}>{cardContent}</div>;
          }
          if (item.source === "manual") {
            return <div key={key} className={className}>{cardContent}</div>;
          }
          return <button key={key} type="button" className={`${className} text-left`} onClick={() => setSelectedItem(item)}>{cardContent}</button>;
        })}
      </div>
      </div>
      {selectedItem ? (
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="related-anime-action-title" onClick={closeDialog}>
          <div className="glass-dialog flex max-h-[90svh] w-full max-w-xl flex-col rounded-2xl border text-foreground" onClick={(event) => event.stopPropagation()}>
            <div className="border-b p-5">
              <h2 id="related-anime-action-title" className="text-lg font-semibold tracking-tight">{selectedItem.pendingUpstreamDeletion ? t("library.relatedAnimeDeletionTitle") : t("library.relatedAnimeActionTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{selectedItem.pendingUpstreamDeletion ? t("library.relatedAnimeDeletionDescription") : t("library.relatedAnimeActionDescription")}</p>
              <div className="mt-4 rounded-2xl border bg-background/50 p-4">
                <div className="flex items-start gap-3">
                  <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                    {assetUrl(selectedItem.posterUrl) ? <Image src={assetUrl(selectedItem.posterUrl) || ""} alt="" fill unoptimized sizes="56px" className="object-cover" /> : <NoPoster />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{selectedItem.provider}</Badge>
                      {selectedItem.airDate ? <Badge variant="secondary">{selectedItem.airDate}</Badge> : null}
                      {selectedItem.episodeCount !== null ? <Badge variant="secondary">{t("library.relatedAnimeEpisodeCount", { count: selectedItem.episodeCount })}</Badge> : null}
                    </div>
                    <p className="mt-2 font-medium leading-snug">{selectedItem.title}</p>
                  </div>
                </div>
              </div>
              {addError ? <p className="mt-3 text-sm font-medium text-destructive">{addError}</p> : null}
            </div>

            {duplicateConflict ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <p className="text-sm text-muted-foreground">{t("search.duplicateAnimeDescription")}</p>
                {duplicateConflict.candidates.map((candidate) => (
                  <div key={candidate.animeId} className="rounded-2xl border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <Badge variant="outline">{candidate.provider}</Badge>
                        <p className="font-medium">{candidate.displayName}</p>
                        <p className="text-sm text-muted-foreground">{candidate.originalName}</p>
                      </div>
                      <Button type="button" disabled={isAdding} onClick={() => void addRelatedToLibrary(selectedItem, { useExistingAnimeId: candidate.animeId })}>{t("search.useExistingProvider")}</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={isAdding || isResolvingDeletion} onClick={closeDialog}>{t("library.cancel")}</Button>
              {selectedItem.pendingUpstreamDeletion ? (
                <>
                  <Button type="button" variant="outline" disabled={isResolvingDeletion} onClick={() => void dismissRemovedRelation(selectedItem)}>{t("library.relatedAnimeDismissRemoved")}</Button>
                  <Button type="button" disabled={isResolvingDeletion} onClick={() => void keepRemovedRelation(selectedItem)}>{t("library.relatedAnimeKeepManual")}</Button>
                </>
              ) : selectedItem.url ? (
                <a className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={selectedItem.url} target="_blank" rel="noreferrer">
                  {t("library.relatedAnimeVisitProvider")}
                </a>
              ) : null}
              {!selectedItem.pendingUpstreamDeletion ? <Button type="button" disabled={isAdding} onClick={() => void addRelatedToLibrary(selectedItem, duplicateConflict ? { useCurrentProvider: true } : undefined)}>
                {duplicateConflict ? t("search.useCurrentProvider") : isAdding ? t("search.addingToLibrary") : t("library.relatedAnimeAddToLibrary")}
              </Button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function relatedAnimeItemKey(item: RelatedAnime, index: number) {
  if (item.manualRelationId !== undefined && item.manualRelationId !== null) {
    return `manual:${item.manualRelationId}`;
  }
  if (item.relationId !== undefined && item.relationId !== null) {
    return `relation:${item.relationId}:${item.source ?? "provider"}:${item.animeId ?? "none"}`;
  }
  if (item.deletionPromptId !== undefined) {
    return `prompt:${item.deletionPromptId}`;
  }
  return `${item.provider}:${item.externalId}:${item.source ?? "provider"}:${item.animeId ?? "none"}:${index}`;
}

function LibraryAnimePickerDialog({ open, title, initialQuery, excludeAnimeIds, onClose, onSelect }: { open: boolean; title: string; initialQuery?: string; excludeAnimeIds?: number[]; onClose: () => void; onSelect: (anime: Anime) => void }) {
  const t = useTranslations();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const excludedIds = (excludeAnimeIds ?? []).join(",");

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    const excluded = new Set(excludedIds ? excludedIds.split(",") : []);
    getLibrary({
      q: query,
      status: "all",
      provider: "all",
      list: "all",
      seasonZero: "exclude",
      sort: "name",
      order: "asc",
      pageSize: 20,
      page: 1,
      signal: controller.signal,
    })
      .then((response) => {
        setError(null);
        setItems(response.items.filter((item) => !excluded.has(String(item.anime.id))));
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
        }
      });
    return () => controller.abort();
  }, [excludedIds, open, query, t]);

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-fixed-below-top-nav fixed inset-0 z-[90] flex items-center justify-center bg-background/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="glass-dialog flex max-h-[85svh] w-full max-w-2xl flex-col rounded-2xl border text-foreground">
        <div className="border-b p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <label className="mt-4 flex items-center gap-2 rounded-2xl border bg-background/50 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.libraryPickerSearch")} className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
          </label>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {items.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.libraryPickerEmpty")}</p> : null}
          {items.map((item) => {
            const poster = assetUrl(item.anime.posterUrl);
            return (
              <button key={item.anime.id} type="button" className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-accent" onClick={() => onSelect(item.anime)}>
                <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                  {poster ? <Image src={poster} alt="" fill unoptimized sizes="56px" className="object-cover" /> : <NoPoster />}
                </div>
                <span className="min-w-0">
                  <span className="line-clamp-1 block font-medium">{item.anime.displayName}</span>
                  <span className="line-clamp-1 block text-sm text-muted-foreground">{item.anime.originalName}</span>
                  <span className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                    <Badge variant="outline">{item.anime.provider}</Badge>
                    {item.anime.airDate ? <Badge variant="secondary">{item.anime.airDate}</Badge> : null}
                    {item.anime.totalEpisodes !== null ? <Badge variant="secondary">{t("library.relatedAnimeEpisodeCount", { count: item.anime.totalEpisodes })}</Badge> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ManualRelatedAnimeDialog({ open, animeId, currentAnimeTitle, relatedItems, existingRelatedAnimeIds, onClose, onChanged }: { open: boolean; animeId: number; currentAnimeTitle: string; relatedItems: RelatedAnime[]; existingRelatedAnimeIds: number[]; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations();
  const [items, setItems] = useState<ManualRelatedAnime[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mappingItem, setMappingItem] = useState<RelatedAnime | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadManualRelated(signal?: AbortSignal) {
    try {
      const response = await getManualRelatedAnime(animeId, signal);
      setError(null);
      setItems(response.manualRelatedAnime);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : t("library.manualRelatedLoadFailed"));
      }
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    getManualRelatedAnime(animeId, controller.signal)
      .then((response) => {
        setError(null);
        setItems(response.manualRelatedAnime);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : t("library.manualRelatedLoadFailed"));
        }
      });
    return () => controller.abort();
  }, [animeId, open, t]);

  async function addManualRelation(anime: Anime) {
    setIsSaving(true);
    setError(null);
    try {
      await createManualRelatedAnime(animeId, anime.id);
      setPickerOpen(false);
      await loadManualRelated();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveNote(item: ManualRelatedAnime) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await updateManualRelatedAnime(animeId, item.id, { note });
      setItems((current) => current.map((entry) => entry.id === item.id ? response.manualRelation : entry));
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteManualRelation(item: ManualRelatedAnime) {
    setIsSaving(true);
    setError(null);
    try {
      await deleteManualRelatedAnime(animeId, item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function mapRelatedToLibrary(item: RelatedAnime, targetAnimeId: number) {
    if (item.relationId === undefined || item.relationId === null) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateRelatedAnimeOverride(animeId, item.relationId, targetAnimeId);
      setMappingItem(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function clearRelatedMapping(item: RelatedAnime) {
    if (item.relationId === undefined || item.relationId === null) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateRelatedAnimeOverride(animeId, item.relationId, null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleProviderImport(item: RelatedAnime, allowProviderImport: boolean) {
    if (item.relationId === undefined || item.relationId === null) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateRelatedAnimeProviderImport(animeId, item.relationId, allowProviderImport);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.relatedAnimeSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  const configurableRelatedItems = relatedItems.filter((item) => item.source !== "manual" && item.relationId !== undefined && item.relationId !== null);

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-center justify-center bg-background/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="glass-dialog flex max-h-[88svh] w-full max-w-2xl flex-col rounded-2xl border text-foreground">
        <div className="border-b p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("library.manualRelatedTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{currentAnimeTitle} · {t("library.manualRelatedDescription")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <Button type="button" className="mt-4" disabled={isSaving} onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4" />{t("library.manualRelatedAdd")}</Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {items.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.manualRelatedEmpty")}</p> : null}
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link className="font-medium hover:underline" href={`/library/${item.relatedAnimeId}`}>{item.relatedAnimeTitle}</Link>
                  <p className="mt-1 text-xs text-muted-foreground">{item.relationType}</p>
                  {editingId === item.id ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("library.manualRelatedNotePlaceholder")} />
                      <Button type="button" disabled={isSaving} onClick={() => void saveNote(item)}>{t("library.manualRelatedSaveNote")}</Button>
                    </div>
                  ) : item.note ? <p className="mt-2 text-sm text-muted-foreground">{item.note}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" disabled={isSaving} onClick={() => { setEditingId(item.id); setNote(item.note ?? ""); }}>{t("library.manualRelatedEditNote")}</Button>
                  <Button type="button" variant="outline" disabled={isSaving} onClick={() => void deleteManualRelation(item)}>{t("library.manualRelatedDelete")}</Button>
                </div>
              </div>
            </div>
          ))}
          {configurableRelatedItems.length > 0 ? (
            <div className="space-y-3 border-t pt-4">
              <div>
                <h3 className="font-semibold">{t("library.relatedAnimeMappingTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("library.relatedAnimeMappingDescription")}</p>
              </div>
              {configurableRelatedItems.map((item) => (
                <div key={`${item.externalId}-${item.relationId ?? item.deletionPromptId ?? "prompt"}`} className="rounded-2xl border bg-background/50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.provider}</Badge>
                        {item.mappedByOverride ? <Badge variant="secondary">{t("library.relatedAnimeBadgeMapped")}</Badge> : null}
                        {item.pendingUpstreamDeletion ? <Badge variant="secondary">{t("library.relatedAnimeBadgeRemoved")}</Badge> : null}
                        {item.needsManualMapping ? <Badge variant="secondary">{t("library.relatedAnimeBadgeNeedsMapping")}</Badge> : null}
                      </div>
                      <p className="mt-2 font-medium">{item.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.airDate ?? t("library.relatedAnimeTba")}{item.episodeCount !== null ? ` · ${t("library.relatedAnimeEpisodeCount", { count: item.episodeCount })}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {item.relationId !== undefined && item.relationId !== null ? <Button type="button" variant="outline" disabled={isSaving} onClick={() => setMappingItem(item)}>{t("library.relatedAnimeMapToLibrary")}</Button> : null}
                      {item.mappedByOverride && item.relationId !== undefined && item.relationId !== null ? <Button type="button" variant="outline" disabled={isSaving} onClick={() => void clearRelatedMapping(item)}>{t("library.relatedAnimeClearMapping")}</Button> : null}
                    </div>
                  </div>
                  {item.mappedByOverride && item.relationId !== undefined && item.relationId !== null ? (
                    <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
                      <span className="text-sm text-muted-foreground">{t("library.relatedAnimeAllowProviderImport")}</span>
                      <DangerSwitch checked={item.allowProviderImport === true} disabled={isSaving} onChange={(checked) => void toggleProviderImport(item, checked)} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <LibraryAnimePickerDialog open={pickerOpen} title={t("library.libraryPickerTitle")} excludeAnimeIds={[animeId, ...existingRelatedAnimeIds, ...items.map((item) => item.relatedAnimeId)]} onClose={() => setPickerOpen(false)} onSelect={(anime) => void addManualRelation(anime)} />
      <LibraryAnimePickerDialog open={mappingItem !== null} title={t("library.libraryPickerTitle")} excludeAnimeIds={[animeId]} initialQuery={mappingItem?.title ?? ""} onClose={() => setMappingItem(null)} onSelect={(anime) => { if (mappingItem) void mapRelatedToLibrary(mappingItem, anime.id); }} />
    </div>
  );
}

function DangerSwitch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-red-500 bg-red-500" : "border-border bg-muted",
      )}
      onClick={() => onChange(!checked)}
    >
      <span className={cn("h-5 w-5 rounded-full bg-background shadow-sm transition-transform", checked && "translate-x-5")} />
    </button>
  );
}

function isDuplicateConflictBody(body: unknown): body is { conflict: DuplicateAnimeConflict } {
  if (!body || typeof body !== "object") {
    return false;
  }
  const conflict = (body as { conflict?: unknown }).conflict;
  return Boolean(conflict && typeof conflict === "object" && Array.isArray((conflict as { candidates?: unknown }).candidates));
}
