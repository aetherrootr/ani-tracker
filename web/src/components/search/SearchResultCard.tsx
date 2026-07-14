import Link from "next/link";
import Image from "next/image";
import { BookOpenCheck, ChevronDown, ChevronRight, ExternalLink, Eye, ImageOff, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { addSearchResultToLibrary, getTvdbSeasons } from "@/features/search/api";
import type { AnimeSearchResult, DuplicateAnimeConflict, DuplicateResolution } from "@/features/search/types";
import { ApiError } from "@/lib/api-client";

type SearchResultCardProps = {
  result: AnimeSearchResult;
  imageFailed: boolean;
  onImageError: (imageUrl: string) => void;
  onLibraryAdded: (provider: string, externalId: string, animeId: number, libraryStatus: string) => void;
};

export function SearchResultCard({ result, imageFailed, onImageError, onLibraryAdded }: SearchResultCardProps) {
  const t = useTranslations();
  const imageUrl = result.imageUrl;
  const hasImage = imageUrl && !imageFailed;
  const [showDetails, setShowDetails] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateAnimeConflict | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<AnimeSearchResult | null>(null);
  const [showTvdbSeasons, setShowTvdbSeasons] = useState(false);
  const [tvdbSeasons, setTvdbSeasons] = useState<AnimeSearchResult[] | null>(null);
  const [tvdbSeasonsError, setTvdbSeasonsError] = useState<string | null>(null);
  const [isLoadingTvdbSeasons, setIsLoadingTvdbSeasons] = useState(false);
  const [addingExternalId, setAddingExternalId] = useState<string | null>(null);
  const [isAddingAllSeasons, setIsAddingAllSeasons] = useState(false);
  const isTvdbResult = result.provider === "tvdb";

  async function addToLibrary(target: AnimeSearchResult = result, duplicateResolution?: DuplicateResolution): Promise<boolean> {
    setIsAdding(true);
    setAddingExternalId(target.externalId);
    setAddError(null);
    try {
      const response = await addSearchResultToLibrary(target.provider, target.externalId, duplicateResolution);
      setDuplicateConflict(null);
      setDuplicateTarget(null);
      onLibraryAdded(target.provider, target.externalId, response.anime.id, response.progress.status);
      setTvdbSeasons((current) => current?.map((season) => season.externalId === target.externalId ? { ...season, inLibrary: true, animeId: response.anime.id, libraryStatus: response.progress.status } : season) ?? null);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isDuplicateConflictBody(err.body)) {
        setDuplicateConflict(err.body.conflict);
        setDuplicateTarget(target);
        return false;
      }
      setAddError(err instanceof Error ? err.message : t("search.addToLibraryFailed"));
      return false;
    } finally {
      setIsAdding(false);
      setAddingExternalId(null);
    }
  }

  async function openTvdbSeasons() {
    setShowTvdbSeasons(true);
    if (tvdbSeasons !== null || isLoadingTvdbSeasons) {
      return;
    }
    setIsLoadingTvdbSeasons(true);
    setTvdbSeasonsError(null);
    try {
      const response = await getTvdbSeasons(result.externalId);
      setTvdbSeasons(response.results);
    } catch (err) {
      setTvdbSeasonsError(err instanceof Error ? err.message : t("search.tvdbSeasonsFailed"));
    } finally {
      setIsLoadingTvdbSeasons(false);
    }
  }

  async function addAllTvdbSeasons() {
    if (!tvdbSeasons) {
      return;
    }
    setIsAddingAllSeasons(true);
    try {
      for (const season of tvdbSeasons) {
        if (season.inLibrary) {
          continue;
        }
        const added = await addToLibrary(season);
        if (!added) {
          break;
        }
      }
    } finally {
      setIsAddingAllSeasons(false);
    }
  }

  return (
    <>
    <Card className="overflow-hidden">
      <CardContent className="grid grid-cols-[72px_1fr_auto] gap-3 p-3 sm:grid-cols-[128px_1fr_auto] sm:gap-4 sm:p-4 md:grid-cols-[128px_1fr_180px] md:p-5">
        <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground sm:h-44 sm:rounded-xl">
          {hasImage ? (
            <Image
              src={imageUrl}
              alt={t("anime.coverAlt", { title: result.title })}
              fill
              unoptimized
              sizes="(min-width: 640px) 128px, 72px"
              className="object-cover"
              onError={() => onImageError(imageUrl)}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-[10px] sm:gap-2 sm:text-xs">
              <ImageOff className="h-5 w-5 sm:h-6 sm:w-6" />
              {t("anime.noCover")}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2 sm:space-y-3">
          <div className="space-y-1">
            <h2 className="line-clamp-1 text-sm font-semibold tracking-tight sm:line-clamp-2 sm:text-xl">
              {result.title}
            </h2>
            {result.originalTitle ? (
              <p className="line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                {t("anime.originalTitle", { title: result.originalTitle })}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <button
                type="button"
                className="group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label={showDetails ? t("anime.collapseDetails") : t("anime.expandDetails")}
                onClick={() => setShowDetails((current) => !current)}
              >
                {showDetails ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                  {showDetails ? t("anime.collapseDetails") : t("anime.expandDetails")}
                </span>
              </button>
              {!showDetails ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Badge variant="outline">{result.provider}</Badge>
                  {result.platform ? <Badge variant="secondary">{result.platform}</Badge> : null}
                  {result.episodeCount !== null ? (
                    <Badge variant="secondary">{t("anime.episodeCount", { count: result.episodeCount })}</Badge>
                  ) : null}
                  {result.airDate ? <Badge variant="secondary">{result.airDate}</Badge> : null}
                </div>
              ) : null}
            </div>

            {showDetails ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border bg-muted/30 p-2 text-xs sm:gap-2 sm:rounded-xl sm:p-3 sm:text-sm lg:grid-cols-3">
                <SearchResultDetail label="Provider" value={result.provider} />
                <SearchResultDetail label={t("anime.externalId")} value={result.externalId} />
                <SearchResultDetail label={t("anime.platform")} value={result.platform} />
                <SearchResultDetail
                  label={t("anime.episodes")}
                  value={result.episodeCount !== null ? t("anime.episodeCount", { count: result.episodeCount }) : null}
                />
                <SearchResultDetail label={t("anime.airDate")} value={result.airDate} />
              </div>
            ) : null}
          </div>

          {result.summary ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-3 sm:text-sm sm:leading-6">
              {result.summary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground sm:text-sm">{t("anime.noSummary")}</p>
          )}

          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline sm:text-sm"
          >
            {t("anime.viewOnProvider", { provider: result.provider })}
            <ExternalLink className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </a>
        </div>

        <div className="flex items-center md:border-l md:pl-4">
          <div className="flex w-full flex-col items-center justify-center gap-2 md:min-h-44 md:rounded-2xl md:bg-muted/25 md:p-3">
            {isTvdbResult ? (
              <Button
                type="button"
                className="h-11 w-11 rounded-full px-0 text-xs md:h-[46px] md:w-full md:rounded-xl md:px-3 sm:text-sm"
                disabled={isLoadingTvdbSeasons}
                aria-label={isLoadingTvdbSeasons ? t("search.loadingTvdbSeasons") : t("search.viewTvdbSeasons")}
                title={isLoadingTvdbSeasons ? t("search.loadingTvdbSeasons") : t("search.viewTvdbSeasons")}
                onClick={() => void openTvdbSeasons()}
              >
                <Eye className="h-4 w-4" />
                <span className="hidden md:inline">{isLoadingTvdbSeasons ? t("search.loadingTvdbSeasons") : t("search.viewTvdbSeasons")}</span>
              </Button>
            ) : result.inLibrary && result.animeId ? (
              <Link
                href={`/library/${result.animeId}`}
                className="inline-flex h-11 w-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border bg-background/60 px-0 text-[11px] font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[46px] md:w-full md:rounded-xl md:px-2.5 lg:text-xs"
                aria-label={t("search.viewInLibrary")}
                title={t("search.viewInLibrary")}
              >
                <BookOpenCheck className="h-4 w-4" />
                <span className="hidden md:inline">{t("search.viewInLibrary")}</span>
              </Link>
            ) : (
              <Button
                type="button"
                className="h-11 w-11 rounded-full px-0 text-xs md:h-[46px] md:w-full md:rounded-xl md:px-3 sm:text-sm"
                disabled={isAdding}
                aria-label={isAdding ? t("search.addingToLibrary") : t("search.addToLibrary")}
                title={isAdding ? t("search.addingToLibrary") : t("search.addToLibrary")}
                onClick={() => void addToLibrary()}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">{addingExternalId === result.externalId ? t("search.addingToLibrary") : t("search.addToLibrary")}</span>
              </Button>
            )}
            {addError ? <p className="text-center text-xs text-destructive">{addError}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
    {showTvdbSeasons ? (
      <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="tvdb-seasons-title" onClick={() => setShowTvdbSeasons(false)}>
        <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-3xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/70 p-4 backdrop-blur sm:p-5">
            <div>
              <h2 id="tvdb-seasons-title" className="text-lg font-semibold tracking-tight">{t("search.tvdbSeasonsTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("search.tvdbSeasonsDescription")}</p>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/40 p-3">
                <p className="min-w-0 flex-1 truncate text-sm">{result.title}</p>
                <Button type="button" size="sm" className="shrink-0 sm:hidden" disabled={isAdding || isAddingAllSeasons || !tvdbSeasons?.some((season) => !season.inLibrary)} onClick={() => void addAllTvdbSeasons()}>{isAddingAllSeasons ? t("search.addingToLibrary") : t("search.addAllSeasons")}</Button>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("library.cancel")} onClick={() => setShowTvdbSeasons(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {isLoadingTvdbSeasons ? <p className="text-sm text-muted-foreground">{t("search.loadingTvdbSeasons")}</p> : null}
            {tvdbSeasonsError ? <p className="text-sm text-destructive">{tvdbSeasonsError}</p> : null}
            {tvdbSeasons?.map((season) => (
              <div key={season.externalId} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="relative flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground sm:h-28 sm:w-20">
                      {season.imageUrl ? (
                        <Image
                          src={season.imageUrl}
                          alt={t("anime.coverAlt", { title: season.title })}
                          fill
                          unoptimized
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-[10px]">
                          <ImageOff className="h-4 w-4" />
                          {t("anime.noCover")}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{season.provider}</Badge>
                      {season.episodeCount !== null ? <Badge variant="secondary">{t("anime.episodeCount", { count: season.episodeCount })}</Badge> : null}
                      {season.airDate ? <Badge variant="secondary">{t("anime.airDate")}: {season.airDate}</Badge> : null}
                    </div>
                    <p className="font-medium">{season.title}</p>
                    <a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={season.url} target="_blank" rel="noreferrer">
                      {t("anime.viewOnProvider", { provider: season.provider })}<ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    </div>
                  </div>
                  {season.inLibrary && season.animeId ? (
                    <Link href={`/library/${season.animeId}`} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                      <BookOpenCheck className="h-4 w-4" />
                      {t("search.viewInLibrary")}
                    </Link>
                  ) : (
                    <Button type="button" className="shrink-0 whitespace-nowrap" disabled={isAdding || isAddingAllSeasons} onClick={() => void addToLibrary(season)}>
                      <Plus className="h-4 w-4" />
                      {addingExternalId === season.externalId ? t("search.addingToLibrary") : t("search.addToLibrary")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={isAdding} onClick={() => setShowTvdbSeasons(false)}>{t("library.cancel")}</Button>
            <Button type="button" disabled={isAdding || isAddingAllSeasons || !tvdbSeasons?.some((season) => !season.inLibrary)} onClick={() => void addAllTvdbSeasons()}>{isAddingAllSeasons ? t("search.addingToLibrary") : t("search.addAllSeasons")}</Button>
          </div>
        </div>
      </div>
    ) : null}
    {duplicateConflict ? (
      <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="duplicate-anime-title" onClick={() => setDuplicateConflict(null)}>
        <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-2xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/70 p-4 backdrop-blur sm:p-5">
            <div>
              <h2 id="duplicate-anime-title" className="text-lg font-semibold tracking-tight">{t("search.duplicateAnimeTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("search.duplicateAnimeDescription")}</p>
              <p className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">
                {duplicateConflict.provider} · {duplicateConflict.externalId} · {duplicateConflict.title}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("library.cancel")} onClick={() => setDuplicateConflict(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {duplicateConflict.candidates.map((candidate) => (
              <div key={candidate.animeId} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{candidate.provider}</Badge>
                      {candidate.airDate ? <Badge variant="secondary">{candidate.airDate}</Badge> : null}
                      {candidate.episodeCount !== null ? <Badge variant="secondary">{t("anime.episodeCount", { count: candidate.episodeCount })}</Badge> : null}
                    </div>
                    <p className="font-medium">{candidate.displayName}</p>
                    <p className="text-sm text-muted-foreground">{candidate.originalName}</p>
                    {candidate.url ? <a className="text-sm font-medium text-primary hover:underline" href={candidate.url} target="_blank" rel="noreferrer">{t("anime.viewOnProvider", { provider: candidate.provider })}</a> : null}
                  </div>
                  <Button type="button" disabled={isAdding} onClick={() => void addToLibrary(duplicateTarget ?? result, { useExistingAnimeId: candidate.animeId })}>
                    {t("search.useExistingProvider")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={isAdding} onClick={() => setDuplicateConflict(null)}>{t("library.cancel")}</Button>
            <Button type="button" disabled={isAdding} onClick={() => void addToLibrary(duplicateTarget ?? result, { useCurrentProvider: true })}>{t("search.useCurrentProvider")}</Button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function isDuplicateConflictBody(body: unknown): body is { conflict: DuplicateAnimeConflict } {
  if (!body || typeof body !== "object") {
    return false;
  }
  const conflict = (body as { conflict?: unknown }).conflict;
  return Boolean(conflict && typeof conflict === "object" && Array.isArray((conflict as { candidates?: unknown }).candidates));
}

function SearchResultDetail({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations();

  return (
    <div className="min-w-0 space-y-0.5 sm:space-y-1">
      <div className="text-[10px] text-muted-foreground sm:text-xs">{label}</div>
      <div className="truncate font-medium">{value ?? t("anime.unknown")}</div>
    </div>
  );
}
