"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, ExternalLink, LoaderCircle, Plus, Repeat2, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const locale = useLocale();
  const router = useRouter();
  const { data, setData, isLoading, error, retry } = useAnimeDetail(animeId);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuRect, setStatusMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusPopoverRef = useRef<HTMLDivElement | null>(null);
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
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

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
    if (!statusMenuOpen) {
      return;
    }

    function updateStatusMenuPosition() {
      const trigger = statusTriggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 180);
      const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16));
      setStatusMenuRect({ left, top: rect.bottom + 8, width });
    }

    const frame = requestAnimationFrame(updateStatusMenuPosition);

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (statusTriggerRef.current?.contains(target) || statusPopoverRef.current?.contains(target)) {
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
    window.addEventListener("resize", updateStatusMenuPosition);
    window.addEventListener("scroll", updateStatusMenuPosition, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateStatusMenuPosition);
      window.removeEventListener("scroll", updateStatusMenuPosition, true);
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
    if (!data || statusPending || status === data.progress.status) {
      return false;
    }
    if (status === "dropped") {
      setDropConfirm(true);
      return false;
    }
    setStatusPending(true);
    setStatusError(null);
    try {
      const result = await updateAnimeStatus(animeId, status);
      updateProgress(result.progress);
      return true;
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : t("library.statusUpdateFailed"));
      return false;
    } finally {
      setStatusPending(false);
    }
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
  const providerDisplayName = isLocalSnapshot ? t("library.localSnapshotProvider") : formatProvider(data.anime.provider);
  const canDiscoverRelatedAnime = Boolean(!isLocalSnapshot && data.features?.seasonDiscovery && RELATED_ANIME_DISCOVERY_BY_PROVIDER[data.anime.provider as keyof typeof RELATED_ANIME_DISCOVERY_BY_PROVIDER]);
  const activeEpisodeConflicts = episodeConflicts.length > 0 ? episodeConflicts : data.episodeConflicts;
  const totalEpisodes = data.anime.episodeCount || data.anime.totalEpisodes || 0;
  const watchedEpisodes = Math.max(data.progress.lastWatchedEpisodeNumber ?? 0, 0);
  const nextEpisodeNumber = totalEpisodes > 0 ? Math.min(watchedEpisodes + 1, totalEpisodes) : null;
  const progressPercent = totalEpisodes > 0 ? Math.min(100, Math.round((watchedEpisodes / totalEpisodes) * 100)) : 0;
  const heroActionLabel = nextEpisodeNumber ? t(`library.primaryAction.${data.progress.status}`, { episode: nextEpisodeNumber }) : t("library.noEpisodeAction");

  function handleHeroAction() {
    if (!data) {
      return;
    }
    if (!nextEpisodeNumber) {
      return;
    }
    if (data.progress.status === "plan_to_watch" || data.progress.status === "on_hold" || data.progress.status === "dropped") {
      void setStatus("watching").then((updated) => { if (updated) document.getElementById("episode-list")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    } else {
      document.getElementById("episode-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-8">
      {data.progress.status === "dropped" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface-card))] p-4 shadow-[var(--shadow-low)] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-destructive">{t("library.droppedBanner")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void setStatus("watching")}>{t("library.restoreWatching")}</Button>
            <Link className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-[var(--surface-hover)]" href="/library">{t("library.backToLibrary")}</Link>
          </div>
        </div>
      ) : null}

      {syncError ? (
        <div className="rounded-2xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface-card))] p-4 text-sm font-medium text-destructive shadow-[var(--shadow-low)]">
          {syncError}
        </div>
      ) : null}

      {statusError ? (
        <div className="rounded-2xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface-card))] p-4 text-sm font-medium text-destructive shadow-[var(--shadow-low)]" role="alert">{statusError}</div>
      ) : null}

      {seasonDiscoveryMessage ? (
        <div className="rounded-2xl border border-primary/20 bg-[color-mix(in_srgb,var(--accent-solid)_8%,var(--surface-card))] p-4 text-sm font-medium text-primary shadow-[var(--shadow-low)]">
          {seasonDiscoveryMessage}
        </div>
      ) : null}

      {activeEpisodeConflicts.length > 0 ? (
        <div className="rounded-2xl border border-primary/25 bg-[color-mix(in_srgb,var(--accent-solid)_8%,var(--surface-card))] p-4 shadow-[var(--shadow-low)]">
          <p className="text-sm font-semibold text-primary">{t("library.syncEpisodeConflictsTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("library.syncEpisodeConflictsDescription", { count: activeEpisodeConflicts.length })}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button type="button" size="sm" onClick={() => void activateLocalSnapshotFromConflict()}>{t("library.useLocalSnapshot")}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setProviderSwitchOpen(true)}>{t("library.switchProvider")}</Button>
          </div>
        </div>
      ) : null}

      <section className="anime-detail-hero floating-surface relative overflow-hidden rounded-[var(--radius-modal)]">
        <div className="hero-visual absolute inset-0 overflow-hidden rounded-[inherit]">
          {poster ? (
            <Image
              key={poster}
              src={poster}
              alt=""
              fill
              unoptimized
              sizes="100vw"
              className="scale-110 object-cover opacity-20 blur-2xl"
            />
          ) : <div className="absolute inset-0 bg-gradient-to-br from-muted to-card" />}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgb(170_165_255_/_0.22),transparent_34%),linear-gradient(105deg,rgb(250_250_255_/_0.74)_0%,rgb(250_250_255_/_0.88)_42%,rgb(250_250_255_/_0.8)_100%)] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(155_140_255_/_0.18),transparent_34%),linear-gradient(105deg,rgb(13_12_18_/_0.86)_0%,rgb(20_17_30_/_0.9)_42%,rgb(20_17_30_/_0.82)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[var(--surface-solid)]/80 to-transparent dark:from-[var(--surface-solid)]/70" />
        </div>

        <div className="anime-detail-hero-grid relative z-10 grid gap-4 p-4 sm:p-6">
          <div className="anime-detail-poster relative aspect-[2/3] overflow-hidden rounded-2xl border bg-muted shadow-xl">
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

          <div className="anime-detail-identity min-w-0" data-has-original={showOriginal || undefined}>
            <div className="anime-detail-identity-header min-w-0">
              <div className="min-w-0">
                <h1 className="anime-detail-title min-w-0 [overflow-wrap:anywhere] text-[clamp(24px,7cqw,52px)] font-semibold leading-[1.06] tracking-tight">{data.anime.displayName}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent-solid)]">
                    {t(`library.status.${data.progress.status}`)}
                  </span>
                  <Badge variant={airStatusBadgeVariant(data.anime.airStatus)} className="px-3 py-1 text-sm font-medium">
                    {t(`library.airStatus.${data.anime.airStatus}`)}
                  </Badge>
                  <span>{formatAnimeType(data.anime.type, t)}</span>
                  <span>{totalEpisodes > 0 ? t("library.relatedAnimeEpisodeCount", { count: totalEpisodes }) : t("library.episodeCountUnknown")}</span>
                  <span>{data.anime.airDate?.slice(0, 4) ?? t("anime.unknown")}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {isLocalSnapshot ? t("library.localSnapshotActive") : t("library.lastSynced", { time: formatLastSynced(data.anime.lastSyncedAt, t("library.neverSynced"), locale) })}
                  </span>
                  {isPosterRefreshing ? <span className="text-xs text-[var(--text-tertiary)]">{t("library.posterRefreshing")}</span> : null}
                </div>
              </div>
            </div>
            {showOriginal ? <p className="anime-detail-original-title min-w-0 [overflow-wrap:anywhere] text-muted-foreground">{data.anime.originalName}</p> : null}
            <div className="anime-detail-hero-actions flex items-center gap-1">
              <CopyAnimeTitleButton title={data.anime.displayName} />
              <AnimeHeroSettingsMenu
                anime={data.anime}
                isSyncing={isSyncing}
                isDiscoveringSeasons={isDiscoveringSeasons}
                canDiscoverRelatedAnime={canDiscoverRelatedAnime}
                isLocalSnapshot={isLocalSnapshot}
                onAnimeChange={updateAnime}
                onSyncAnime={() => void syncCurrentAnime()}
                onDiscoverRelatedAnime={() => void discoverSeasons()}
                onManageManualRelated={() => setManualRelatedOpen(true)}
              />
            </div>
          </div>

          <div className="anime-detail-summary max-w-[72ch] min-w-0">
            <div className="hero-description relative text-[15px] leading-[1.65] text-[var(--text-secondary)]" data-expanded="false">
              <p className="whitespace-pre-wrap">{summary}</p>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[rgb(250_250_255_/_0.92)] to-transparent dark:from-[rgb(20_17_30_/_0.9)]" aria-hidden="true" />
            </div>
            <button type="button" className="mt-2 text-sm font-semibold text-[var(--accent-solid)] transition-colors hover:text-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" onClick={() => setSummaryDialogOpen(true)}>
              {t("anime.viewFullSummary")}
            </button>
          </div>

          <div className="anime-detail-progress rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-card)]/95 p-4 shadow-[var(--shadow-low)] sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">
                  {watchedEpisodes > 0 ? t("library.progressSummary", { watched: watchedEpisodes, total: totalEpisodes || "?" }) : t("library.notStarted")}
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight">{nextEpisodeNumber ? t("library.nextEpisodeNumber", { episode: nextEpisodeNumber }) : t("library.noNextEpisode")}</p>
              </div>
              <Button type="button" className="min-h-11 sm:justify-self-end" disabled={!nextEpisodeNumber || statusPending} aria-busy={statusPending} onClick={handleHeroAction}>
                {statusPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{heroActionLabel}
              </Button>
              <div className="grid items-center gap-3 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="h-2 overflow-hidden rounded-full bg-[rgb(95_87_125_/_0.09)] dark:bg-[rgb(255_255_255_/_0.1)]" role="progressbar" aria-label={t("library.watchProgress")} aria-valuemin={0} aria-valuemax={totalEpisodes} aria-valuenow={watchedEpisodes}>
                  <div className={cn("h-full rounded-full transition-all", progressPercent >= 100 ? "bg-[var(--watched)]" : "bg-[var(--accent-solid)]")} style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="text-sm font-medium text-muted-foreground">{progressPercent}%</span>
              </div>
            </div>
          </div>

          <div className="anime-detail-metadata grid grid-cols-2 gap-3">
            <button
              ref={statusTriggerRef}
              type="button"
              className="metadata-card flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-[var(--surface-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              aria-expanded={statusMenuOpen}
              aria-haspopup="menu"
              aria-controls="anime-status-menu"
              onClick={() => setStatusMenuOpen((current) => !current)}
            >
              <span>
                <span className="block text-xs font-medium text-muted-foreground">{t("library.statusLabel")}</span>
                <span className="mt-1 block font-semibold">{t(`library.status.${data.progress.status}`)}</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", statusMenuOpen && "rotate-180")} />
            </button>

            <button
              type="button"
              className="metadata-card group flex min-h-11 items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-[var(--surface-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              aria-label={`${t("library.switchProvider")}: ${providerDisplayName}`}
              title={t("library.switchProviderHint")}
              onClick={() => setProviderSwitchOpen(true)}
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-muted-foreground">{t("library.dataSource")}</span>
                <span className="mt-1 block truncate font-semibold">{providerDisplayName}</span>
              </span>
              <Repeat2 className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--accent-solid)]" aria-hidden="true" />
            </button>
            <InfoCard label={t("anime.airDate")} value={formatDate(data.anime.airDate, locale, t("anime.unknown"))} />
            {data.anime.url ? (
              <a className="metadata-card rounded-2xl border p-3 transition-colors hover:bg-[var(--surface-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" href={data.anime.url} target="_blank" rel="noreferrer">
                <span className="block text-xs font-medium text-muted-foreground">{t("anime.viewOnProvider", { provider: providerDisplayName })}</span>
                <span className="mt-1 inline-flex items-center gap-2 font-semibold">
                  {data.anime.externalId}<ExternalLink className="h-4 w-4" />
                </span>
              </a>
            ) : null}
          </div>
        </div>
      </section>
      <StatusMenuPortal
        open={statusMenuOpen}
        rect={statusMenuRect}
        popoverRef={statusPopoverRef}
        currentStatus={data.progress.status}
        triggerRef={statusTriggerRef}
        onClose={() => setStatusMenuOpen(false)}
        onSelect={(status) => { setStatusMenuOpen(false); void setStatus(status); }}
      />

      <RelatedAnimeSection animeId={animeId} provider={providerDisplayName} items={data.anime.relatedAnime ?? []} onRefresh={() => void refreshDetail()} />

      <ManualRelatedAnimeDialog open={manualRelatedOpen} animeId={animeId} currentAnimeTitle={data.anime.displayName} relatedItems={data.anime.relatedAnime ?? []} existingRelatedAnimeIds={(data.anime.relatedAnime ?? []).filter((item) => item.source === "manual" && item.animeId !== null).map((item) => item.animeId as number)} onClose={() => setManualRelatedOpen(false)} onChanged={() => void refreshDetail()} />

      <EpisodeList animeId={animeId} metadataSource={data.progress.metadataSource} progress={data.progress} refreshKey={episodeRefreshKey} onProgressChange={updateProgress} />

      <ConfirmDialog
        open={dropConfirm}
        title={t("library.confirmDropTitle")}
        description={t("library.confirmDropDescription")}
        danger
        confirmLabel={t("library.status.dropped")}
        onCancel={() => setDropConfirm(false)}
        onConfirm={() => {
          setDropConfirm(false);
          setStatusPending(true);
          setStatusError(null);
          updateAnimeStatus(animeId, "dropped")
            .then((result) => updateProgress(result.progress))
            .catch((err: unknown) => setStatusError(err instanceof Error ? err.message : t("library.statusUpdateFailed")))
            .finally(() => setStatusPending(false));
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
        onSwitched={(response) => {
          setProviderSwitchOpen(false);
          if (response.anime.id === animeId) {
            setData((current) => current ? {
              ...current,
              anime: response.anime,
              progress: response.progress,
              episodeConflicts: response.episodeConflicts,
            } : current);
            setEpisodeConflicts(response.episodeConflicts);
            setEpisodeRefreshKey((current) => current + 1);
            return;
          }
          router.push(`/library/${response.anime.id}`);
        }}
      />
      <DescriptionSheet
        open={summaryDialogOpen}
        title={data.anime.displayName}
        originalTitle={showOriginal ? data.anime.originalName : null}
        meta={[data.anime.airDate?.slice(0, 4) ?? t("anime.unknown"), formatAnimeType(data.anime.type, t), providerDisplayName].join(" · ")}
        summary={summary}
        onClose={() => setSummaryDialogOpen(false)}
      />
    </div>
  );
}

function CopyAnimeTitleButton({ title }: { title: string }) {
  const t = useTranslations();
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copyTitle() {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    try {
      await writeClipboardText(title);
      setStatus("success");
    } catch {
      setStatus("error");
    }
    resetTimer.current = window.setTimeout(() => setStatus("idle"), 1800);
  }

  const message = status === "success"
    ? t("library.copyAnimeTitleSuccess", { title })
    : status === "error"
      ? t("library.copyAnimeTitleFailed")
      : t("library.copyAnimeTitle", { title });
  return <>
    <button
      type="button"
      className={cn(
        "interactive-surface inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
        status === "success" && "text-[var(--watched)]",
        status === "error" && "text-destructive",
      )}
      aria-label={message}
      title={message}
      onClick={() => void copyTitle()}
    >
      {status === "success" ? <Check className="h-[18px] w-[18px]" aria-hidden="true" /> : status === "error" ? <CircleAlert className="h-[18px] w-[18px]" aria-hidden="true" /> : <Copy className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status === "idle" ? "" : message}</span>
  </>;
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function formatLastSynced(value: string | null, fallback: string, locale: string) {
  if (!value) {
    return fallback;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function DescriptionSheet({ open, title, originalTitle, meta, summary, onClose }: { open: boolean; title: string; originalTitle: string | null; meta: string; summary: string; onClose: () => void }) {
  const t = useTranslations();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeDialog = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const previousInert = appShell?.inert ?? false;
    const previousOverflow = scrollContainer?.style.overflow ?? "";
    appShell?.setAttribute("inert", "");
    if (scrollContainer) scrollContainer.style.overflow = "hidden";
    document.documentElement.classList.add("dialog-scroll-lock");
    document.body.classList.add("dialog-scroll-lock");
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-summary-close]")?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (appShell && !previousInert) appShell.removeAttribute("inert");
      if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
      document.documentElement.classList.remove("dialog-scroll-lock");
      document.body.classList.remove("dialog-scroll-lock");
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="description-backdrop fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center min-[1100px]:items-stretch min-[1100px]:justify-end min-[1100px]:p-4" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="description-sheet grid max-h-[calc(100dvh-1.5rem)] w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[28px] border text-foreground min-[1100px]:h-[calc(100dvh-2rem)] min-[1100px]:w-[min(560px,42vw)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--divider)] px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="line-clamp-2 text-lg font-semibold tracking-tight">{t("anime.fullSummary")}</h2>
              <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{title}</p>
              {originalTitle ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{originalTitle}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0 rounded-full" data-summary-close aria-label={t("anime.closeFullSummary")} onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0" viewportClassName="h-full px-5 py-5 text-base leading-[1.8] text-[var(--text-secondary)] sm:px-7 sm:pb-8">
          <p className="whitespace-pre-wrap">{summary}</p>
        </ScrollArea>
      </section>
    </div>,
    document.body,
  );
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

function StatusMenuPortal({
  open,
  rect,
  popoverRef,
  triggerRef,
  currentStatus,
  onClose,
  onSelect,
}: {
  open: boolean;
  rect: { left: number; top: number; width: number } | null;
  popoverRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  currentStatus: UserAnimeStatus;
  onClose: () => void;
  onSelect: (status: UserAnimeStatus) => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    if (!open || !rect) return;
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus());
  }, [currentStatus, open, popoverRef, rect]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']:not([disabled])") ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  }

  if (!open || !rect || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      id="anime-status-menu"
      className="select-content fixed z-[1000] rounded-2xl border text-foreground"
      style={{ left: rect.left, top: rect.top, width: rect.width }}
      role="menu"
      onKeyDown={handleKeyDown}
    >
      <ScrollArea ariaLabel={t("app.scrollableContent")} className="max-h-[min(320px,calc(100svh-2rem))]" viewportClassName="max-h-[min(320px,calc(100svh-2rem))] p-1">
        {STATUS_OPTIONS.map((status) => {
          const active = currentStatus === status;
          return (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={cn(
                "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                active && "bg-[var(--accent-solid)] text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] hover:text-[var(--accent-foreground)]",
                status === "dropped" && !active && "text-destructive hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => onSelect(status)}
            >
              <span>{t(`library.status.${status}`)}</span>
              {active ? <Check className="h-4 w-4" /> : null}
            </button>
          );
        })}
      </ScrollArea>
    </div>,
    document.body,
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metadata-card rounded-2xl border p-3">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 block font-semibold">{value}</span>
    </div>
  );
}

function formatProvider(provider: string) {
  const providers: Record<string, string> = { bangumi: "Bangumi", tvdb: "TheTVDB", tmdb: "TMDB" };
  return providers[provider.toLowerCase()] ?? provider;
}

function airStatusBadgeVariant(status: Anime["airStatus"]): "success" | "warning" | "secondary" {
  if (status === "airing") return "success";
  if (status === "notStarted") return "warning";
  return "secondary";
}

function formatAnimeType(value: string, t: ReturnType<typeof useTranslations>) {
  const key = value.toLowerCase();
  const labels: Record<string, string> = {
    tv: t("library.animeType.tv"),
    movie: t("library.animeType.movie"),
    ova: t("library.animeType.ova"),
    ona: t("library.animeType.ona"),
    special: t("library.animeType.special"),
  };
  return labels[key] ?? value;
}

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function RelatedAnimeSection({
  animeId,
  provider,
  items,
  onRefresh,
}: {
  animeId: number;
  provider: string;
  items: RelatedAnime[];
  onRefresh: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const visibleItems = items.filter((item) => item.animeId !== animeId);
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
  }, [visibleItems.length]);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border bg-[var(--surface-card)] p-5 shadow-[var(--shadow-low)]">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("library.otherRelatedAnimeTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("library.relatedAnimeDescription", { provider })}</p>
      </div>
      <div className="relative">
        {canScrollLeft ? (
          <button
            type="button"
            className="absolute inset-y-0 left-0 z-20 flex items-center bg-gradient-to-r from-card/90 to-transparent pl-1 pr-5 sm:pl-2 sm:pr-8"
            aria-label={t("library.scrollRelatedLeft")}
            onClick={() => scrollList("left")}
          >
            <ChevronLeft className="h-6 w-6 text-foreground/45 sm:h-7 sm:w-7" />
          </button>
        ) : null}
        {canScrollRight ? (
          <button
            type="button"
            className="absolute inset-y-0 right-0 z-20 flex items-center bg-gradient-to-l from-card/90 to-transparent pl-5 pr-1 sm:pl-8 sm:pr-2"
            aria-label={t("library.scrollRelatedRight")}
            onClick={() => scrollList("right")}
          >
            <ChevronRight className="h-6 w-6 text-foreground/45 sm:h-7 sm:w-7" />
          </button>
        ) : null}
      <div ref={scrollRef} className="scrollbar-none flex gap-3 overflow-x-auto overscroll-x-contain pb-1" onScroll={updateScrollHints}>
        {visibleItems.map((item, index) => {
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
          const className = "flex min-h-28 w-[min(20rem,calc(100vw-4rem))] shrink-0 items-center gap-3 rounded-2xl border bg-background/60 p-3 transition-colors hover:bg-[var(--surface-hover)] sm:w-96";
          const cardContent = content;
          if (item.pendingUpstreamDeletion) {
            return <button key={key} type="button" className={`${className} text-left`} onClick={() => setSelectedItem(item)}>{cardContent}</button>;
          }
          if (item.inLibrary && item.animeId !== null) {
            return <Link key={key} className={className} href={`/library/${item.animeId}`}>{cardContent}</Link>;
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
              <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1" viewportClassName="h-full space-y-3 p-4">
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
              </ScrollArea>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={isAdding || isResolvingDeletion} onClick={closeDialog}>{t("library.cancel")}</Button>
              {selectedItem.pendingUpstreamDeletion ? (
                <>
                  <Button type="button" variant="outline" disabled={isResolvingDeletion} onClick={() => void dismissRemovedRelation(selectedItem)}>{t("library.relatedAnimeDismissRemoved")}</Button>
                  <Button type="button" disabled={isResolvingDeletion} onClick={() => void keepRemovedRelation(selectedItem)}>{t("library.relatedAnimeKeepManual")}</Button>
                </>
              ) : selectedItem.url ? (
                <a className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={selectedItem.url} target="_blank" rel="noreferrer">
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
      unwatched: "all",
      airStatus: "all",
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
    <div className="anime-detail-sheet-layer mobile-fixed-below-top-nav fixed inset-0 z-[90] flex items-end justify-center bg-background/85 p-0 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="anime-detail-sheet-panel library-picker-sheet-panel glass-dialog flex max-h-[calc(var(--app-viewport-height)-max(1rem,env(safe-area-inset-top)))] w-full max-w-2xl flex-col rounded-t-[var(--radius-modal)] border text-foreground">
        <div className="anime-detail-sheet-header anime-detail-sheet-diffuse-bottom p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button type="button" variant="ghost" size="icon" className="anime-detail-sheet-close h-11 w-11" aria-label={t("library.cancel")} onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <label className="mt-4 flex items-center gap-2 rounded-[var(--radius-pill)] border bg-background/50 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.libraryPickerSearch")} className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
          </label>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {items.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.libraryPickerEmpty")}</p> : null}
          {items.map((item) => {
            const poster = assetUrl(item.anime.posterUrl);
            return (
              <button key={item.anime.id} type="button" className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-[var(--surface-hover)]" onClick={() => onSelect(item.anime)}>
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

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

  return createPortal(
    <div className="anime-detail-sheet-layer mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-end justify-center bg-background/85 p-0 backdrop-blur-md" role="dialog" aria-modal="true">
      <div ref={dialogRef} className={cn("anime-detail-sheet-panel manual-related-sheet-panel glass-dialog flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[var(--radius-modal)] border text-foreground", configurableRelatedItems.length > 0 ? "manual-related-sheet-panel-split h-[calc(var(--app-viewport-height)-max(1rem,env(safe-area-inset-top)))] max-h-[48rem]" : "max-h-[calc(var(--app-viewport-height)-max(1rem,env(safe-area-inset-top)))]")}>
        <div className="anime-detail-sheet-header anime-detail-sheet-diffuse-bottom p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t("library.manualRelatedTitle")}</h2>
              <p className="mt-1 break-words text-sm text-muted-foreground">{currentAnimeTitle} · {t("library.manualRelatedDescription")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="anime-detail-sheet-close h-11 w-11 shrink-0" data-dialog-close aria-label={t("library.cancel")} onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <Button type="button" className="mt-4" disabled={isSaving} onClick={() => setPickerOpen(true)}><Plus className="h-4 w-4" />{t("library.manualRelatedAdd")}</Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain p-4", configurableRelatedItems.length > 0 ? "max-h-[40%] shrink-0" : "min-h-0 flex-1 pb-[max(1rem,env(safe-area-inset-bottom))]")}>
            {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            {items.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.manualRelatedEmpty")}</p> : null}
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link className="block break-words font-medium hover:underline" href={`/library/${item.relatedAnimeId}`}>{item.relatedAnimeTitle}</Link>
                    <p className="mt-1 text-xs text-muted-foreground">{item.relationType}</p>
                    {editingId === item.id ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("library.manualRelatedNotePlaceholder")} />
                        <Button type="button" disabled={isSaving} onClick={() => void saveNote(item)}>{t("library.manualRelatedSaveNote")}</Button>
                      </div>
                    ) : item.note ? <p className="mt-2 break-words text-sm text-muted-foreground">{item.note}</p> : null}
                  </div>
                  <div className="flex max-w-full shrink-0 flex-wrap gap-2 sm:max-w-[55%] sm:justify-end">
                    <Button type="button" variant="outline" disabled={isSaving} onClick={() => { setEditingId(item.id); setNote(item.note ?? ""); }}>{t("library.manualRelatedEditNote")}</Button>
                    <Button type="button" variant="outline" disabled={isSaving} onClick={() => void deleteManualRelation(item)}>{t("library.manualRelatedDelete")}</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {configurableRelatedItems.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="anime-detail-sheet-section-header anime-detail-sheet-diffuse-both shrink-0 px-4 pt-4">
                <h3 className="font-semibold">{t("library.relatedAnimeMappingTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("library.relatedAnimeMappingDescription")}</p>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
                        <p className="mt-2 break-words font-medium">{item.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.airDate ?? t("library.relatedAnimeTba")}{item.episodeCount !== null ? ` · ${t("library.relatedAnimeEpisodeCount", { count: item.episodeCount })}` : ""}</p>
                      </div>
                      <div className="flex max-w-full shrink-0 flex-wrap gap-2 sm:max-w-[55%] sm:justify-end">
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
            </div>
          ) : null}
        </div>
      </div>
      <LibraryAnimePickerDialog open={pickerOpen} title={t("library.libraryPickerTitle")} excludeAnimeIds={[animeId, ...existingRelatedAnimeIds, ...items.map((item) => item.relatedAnimeId)]} onClose={() => setPickerOpen(false)} onSelect={(anime) => void addManualRelation(anime)} />
      <LibraryAnimePickerDialog open={mappingItem !== null} title={t("library.libraryPickerTitle")} excludeAnimeIds={[animeId]} initialQuery={mappingItem?.title ?? ""} onClose={() => setMappingItem(null)} onSelect={(anime) => { if (mappingItem) void mapRelatedToLibrary(mappingItem, anime.id); }} />
    </div>,
    document.body,
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
