"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { assetUrl, getAnimeDetail, resolveEpisodeConflicts, syncAnime, updateAnimeStatus } from "@/features/library/api";
import { useAnimeDetail } from "@/features/library/hooks";
import type { Anime, AnimeProgress, EpisodeConflict, RelatedAnime, UserAnimeStatus } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { AnimeHeroSettingsMenu } from "./AnimeHeroSettingsMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeConflictDialog } from "./EpisodeConflictDialog";
import { EpisodeList } from "./EpisodeList";
import { SkeletonBlock } from "./LibraryPagination";
import { NoPoster } from "./NoPoster";

const STATUS_OPTIONS: UserAnimeStatus[] = ["plan_to_watch", "watching", "completed", "on_hold", "dropped"];
const POSTER_POLL_INTERVAL_MS = 1200;
const POSTER_POLL_ATTEMPTS = 10;

export function AnimeDetailPageContent({ animeId }: { animeId: number }) {
  const t = useTranslations();
  const { data, setData, isLoading, error, retry } = useAnimeDetail(animeId);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const [dropConfirm, setDropConfirm] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [episodeRefreshKey, setEpisodeRefreshKey] = useState(0);
  const [episodeConflicts, setEpisodeConflicts] = useState<EpisodeConflict[]>([]);
  const [isResolvingConflicts, setIsResolvingConflicts] = useState(false);
  const [isPosterRefreshing, setIsPosterRefreshing] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);

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

  async function resolveConflicts(deleteEpisodeIds: number[]) {
    setIsResolvingConflicts(true);
    setSyncError(null);
    try {
      const result = await resolveEpisodeConflicts(animeId, deleteEpisodeIds);
      setData((current) => current ? { ...current, anime: result.anime, progress: result.progress } : current);
      setEpisodeConflicts([]);
      setEpisodeRefreshKey((current) => current + 1);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : t("library.resolveConflictsFailed"));
    } finally {
      setIsResolvingConflicts(false);
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
                      disabled={isSyncing}
                      onClick={() => void syncCurrentAnime()}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
                      {isSyncing ? t("library.syncing") : t("library.syncAnime")}
                    </Button>
                    <span>{t("library.lastSynced", { time: formatLastSynced(data.anime.lastSyncedAt, t("library.neverSynced")) })}</span>
                    {isPosterRefreshing ? <span>{t("library.posterRefreshing")}</span> : null}
                  </div>
                </div>
                <AnimeHeroSettingsMenu anime={data.anime} onAnimeChange={updateAnime} />
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
              <InfoCard label="Provider" value={data.anime.provider} />
              {data.anime.url ? (
                <a className="rounded-2xl border bg-background/35 p-3 backdrop-blur transition-colors hover:bg-background/55" href={data.anime.url} target="_blank" rel="noreferrer">
                  <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("anime.viewOnProvider", { provider: data.anime.provider })}</span>
                  <span className="mt-1 inline-flex items-center gap-2 font-semibold">
                    {data.anime.externalId}<ExternalLink className="h-4 w-4" />
                  </span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <RelatedAnimeSection provider={data.anime.provider} items={data.anime.relatedAnime ?? []} />

      <EpisodeList animeId={animeId} refreshKey={episodeRefreshKey} onProgressChange={updateProgress} />

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
      <EpisodeConflictDialog
        key={episodeConflicts.map((conflict) => conflict.episodeId).join("-")}
        open={episodeConflicts.length > 0}
        conflicts={episodeConflicts}
        isResolving={isResolvingConflicts}
        onCancel={() => setEpisodeConflicts([])}
        onConfirm={(deleteEpisodeIds) => void resolveConflicts(deleteEpisodeIds)}
      />
      {summaryDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
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

function RelatedAnimeSection({ provider, items }: { provider: string; items: RelatedAnime[] }) {
  const t = useTranslations();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
        {items.map((item) => {
          const poster = assetUrl(item.posterUrl);
          const content = (
            <>
              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                {poster ? (
                  <Image src={poster} alt="" fill unoptimized sizes="56px" className="object-cover" />
                ) : <NoPoster />}
              </div>
              <span className="min-w-0">
                <span className="line-clamp-2 block font-medium leading-snug text-foreground">{item.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.airDate ?? t("library.relatedAnimeTba")}
                  {item.episodeCount !== null ? ` · ${t("library.relatedAnimeEpisodeCount", { count: item.episodeCount })}` : ""}
                </span>
              </span>
            </>
          );
          const className = "flex min-h-24 w-80 shrink-0 items-center gap-3 rounded-2xl border bg-background/60 p-3 transition-colors hover:bg-accent sm:w-96";
          if (item.animeId !== null) {
            return <Link key={item.externalId} href={`/library/${item.animeId}`} className={className}>{content}</Link>;
          }
          if (item.url) {
            return <a key={item.externalId} href={item.url} target="_blank" rel="noreferrer" className={className}>{content}</a>;
          }
          return <div key={item.externalId} className={className}>{content}</div>;
        })}
      </div>
      </div>
    </section>
  );
}
