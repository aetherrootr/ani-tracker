"use client";

import Link from "next/link";
import Image from "next/image";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { assetUrl, updateAnimeStatus } from "@/features/library/api";
import { useAnimeDetail } from "@/features/library/hooks";
import type { Anime, AnimeProgress, UserAnimeStatus } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { AnimeHeroSettingsMenu } from "./AnimeHeroSettingsMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { EpisodeList } from "./EpisodeList";
import { SkeletonBlock } from "./LibraryPagination";
import { NoPoster } from "./NoPoster";

const STATUS_OPTIONS: UserAnimeStatus[] = ["plan_to_watch", "watching", "completed", "on_hold", "dropped"];

export function AnimeDetailPageContent({ animeId }: { animeId: number }) {
  const t = useTranslations();
  const { data, setData, isLoading, error, retry } = useAnimeDetail(animeId);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [dropConfirm, setDropConfirm] = useState(false);

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
  const summary = data.anime.summary?.summary ?? t("anime.noSummary");
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

      <section className="relative overflow-hidden rounded-3xl border bg-card shadow-sm">
        {poster ? (
          <Image
            src={poster}
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className="scale-110 object-cover opacity-25 blur-2xl"
          />
        ) : <div className="absolute inset-0 bg-gradient-to-br from-muted to-card" />}
        <div className="absolute inset-0 bg-gradient-to-br from-background/95 via-background/80 to-background/50" />

        <div className="relative z-10 grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:p-8">
          <div className="relative mx-auto hidden aspect-[2/3] w-44 overflow-hidden rounded-2xl border bg-muted shadow-2xl sm:block sm:w-full">
            {poster ? (
              <Image
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
                <h1 className="min-w-0 text-3xl font-semibold tracking-tight sm:text-5xl">{data.anime.displayName}</h1>
                <AnimeHeroSettingsMenu anime={data.anime} onAnimeChange={updateAnime} />
              </div>
              {showOriginal ? <p className="mt-2 text-muted-foreground">{data.anime.originalName}</p> : null}
            </div>
            <div className="relative mx-auto aspect-[2/3] w-44 overflow-hidden rounded-2xl border bg-muted shadow-2xl sm:hidden">
              {poster ? (
                <Image
                  src={poster}
                  alt={t("anime.coverAlt", { title: data.anime.displayName })}
                  fill
                  unoptimized
                  sizes="176px"
                  className="object-cover"
                />
              ) : <NoPoster />}
            </div>
            <div className="scrollbar-none max-h-28 max-w-3xl overflow-y-auto rounded-2xl bg-background/15 p-3 text-xs leading-6 text-muted-foreground backdrop-blur-sm sm:max-h-32 sm:text-sm">
              <p className="whitespace-pre-wrap">{summary}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="relative z-20 rounded-2xl border bg-background/35 p-3 backdrop-blur">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  aria-expanded={statusMenuOpen}
                  onClick={() => setStatusMenuOpen((current) => !current)}
                >
                  <span>
                    <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("library.statusLabel")}</span>
                    <span className="mt-1 block font-semibold">{t(`library.status.${data.progress.status}`)}</span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", statusMenuOpen && "rotate-180")} />
                </button>
                {statusMenuOpen ? (
                  <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-2xl border bg-background/95 p-2 text-foreground shadow-lg shadow-background/30 backdrop-blur-xl dark:bg-background/90">
                    <div className="grid grid-cols-2 gap-2 p-1">
                      {STATUS_OPTIONS.map((status) => (
                        <Button
                          key={status}
                          type="button"
                          size="sm"
                          variant={data.progress.status === status ? "default" : "outline"}
                          className={cn(
                            "min-h-11 px-3 py-2 text-sm sm:min-h-10 sm:text-xs",
                            status === "dropped" && "border-destructive text-destructive hover:bg-destructive/10",
                          )}
                          onClick={() => { setStatusMenuOpen(false); void setStatus(status); }}
                        >
                          {t(`library.status.${status}`)}
                        </Button>
                      ))}
                    </div>
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

      <EpisodeList animeId={animeId} onProgressChange={updateProgress} />

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
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background/35 p-3 backdrop-blur">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 block font-semibold">{value}</span>
    </div>
  );
}
