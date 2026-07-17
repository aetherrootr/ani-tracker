"use client";

import Image from "next/image";
import Link from "next/link";
import { BookOpenCheck, Check, ChevronDown, ChevronRight, ExternalLink, Eye, ImageOff, Loader2, Plus, RotateCcw, Shuffle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ModalSurface } from "@/components/ui/modal-surface";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocaleControls } from "@/i18n/provider";
import { addSearchResultToLibrary, getTvdbSeasons } from "@/features/search/api";
import type { AnimeSearchResult, DuplicateAnimeConflict, DuplicateResolution } from "@/features/search/types";
import { ApiError } from "@/lib/api-client";

type SearchResultCardProps = {
  result: AnimeSearchResult;
  imageFailed: boolean;
  onImageError: (imageUrl: string) => void;
  onLibraryAdded?: (provider: string, externalId: string, animeId: number, libraryStatus: string) => void;
  primaryAction?: { label: string; loadingLabel?: string; icon?: "eye" | "shuffle"; disabled?: boolean; loading?: boolean; onClick: () => void };
};

type SeasonStatus = "pending" | "success" | "failed";

export function SearchResultCard({ result, imageFailed, onImageError, onLibraryAdded, primaryAction }: SearchResultCardProps) {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const detailsId = useId();
  const tvdbTitleId = useId();
  const tvdbDescriptionId = useId();
  const duplicateTitleId = useId();
  const duplicateDescriptionId = useId();
  const [showDetails, setShowDetails] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [lastAddTarget, setLastAddTarget] = useState<AnimeSearchResult>(result);
  const [addedAnnouncement, setAddedAnnouncement] = useState("");
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateAnimeConflict | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<AnimeSearchResult | null>(null);
  const [showTvdbSeasons, setShowTvdbSeasons] = useState(false);
  const [tvdbSeasons, setTvdbSeasons] = useState<AnimeSearchResult[] | null>(null);
  const [tvdbSeasonsError, setTvdbSeasonsError] = useState<string | null>(null);
  const [isLoadingTvdbSeasons, setIsLoadingTvdbSeasons] = useState(false);
  const [addingExternalId, setAddingExternalId] = useState<string | null>(null);
  const [isAddingAllSeasons, setIsAddingAllSeasons] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, total: 0 });
  const [seasonStatuses, setSeasonStatuses] = useState<Record<string, SeasonStatus>>({});
  const cancelBulkRef = useRef(false);
  const isTvdbResult = result.provider === "tvdb";
  const providerLabel = formatProvider(result.provider);
  const formattedDate = formatDate(result.airDate, locale);
  const platformLabel = formatPlatform(result.platform, locale);
  const PrimaryActionIcon = primaryAction?.icon === "eye" ? Eye : Shuffle;
  const hasImage = Boolean(result.imageUrl && !imageFailed);

  async function addToLibrary(target: AnimeSearchResult = result, duplicateResolution?: DuplicateResolution): Promise<boolean> {
    setIsAdding(true);
    setAddingExternalId(target.externalId);
    setLastAddTarget(target);
    setAddError(null);
    setSeasonStatuses((current) => ({ ...current, [target.externalId]: "pending" }));
    try {
      const response = await addSearchResultToLibrary(target.provider, target.externalId, duplicateResolution);
      setDuplicateConflict(null);
      setDuplicateTarget(null);
      onLibraryAdded?.(target.provider, target.externalId, response.anime.id, response.progress.status);
      setTvdbSeasons((current) => current?.map((season) => season.externalId === target.externalId ? { ...season, inLibrary: true, animeId: response.anime.id, libraryStatus: response.progress.status } : season) ?? null);
      setSeasonStatuses((current) => ({ ...current, [target.externalId]: "success" }));
      setAddedAnnouncement(t("search.addedToLibrary", { title: target.title }));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isDuplicateConflictBody(err.body)) {
        setDuplicateConflict(err.body.conflict);
        setDuplicateTarget(target);
        return false;
      }
      setSeasonStatuses((current) => ({ ...current, [target.externalId]: "failed" }));
      setAddError(t("search.addToLibraryFailedWithRecovery"));
      return false;
    } finally {
      setIsAdding(false);
      setAddingExternalId(null);
    }
  }

  async function openTvdbSeasons() {
    setShowTvdbSeasons(true);
    if (tvdbSeasons !== null || isLoadingTvdbSeasons) return;
    setIsLoadingTvdbSeasons(true);
    setTvdbSeasonsError(null);
    try {
      const response = await getTvdbSeasons(result.externalId);
      setTvdbSeasons(response.results);
    } catch {
      setTvdbSeasonsError(t("search.tvdbSeasonsFailed"));
    } finally {
      setIsLoadingTvdbSeasons(false);
    }
  }

  async function addAllTvdbSeasons() {
    const pending = tvdbSeasons?.filter((season) => !season.inLibrary) ?? [];
    if (pending.length === 0) return;
    cancelBulkRef.current = false;
    setIsAddingAllSeasons(true);
    setBulkProgress({ completed: 0, total: pending.length });
    setAddError(null);
    try {
      for (let index = 0; index < pending.length; index += 1) {
        if (cancelBulkRef.current) break;
        const added = await addToLibrary(pending[index]);
        if (!added) break;
        setBulkProgress({ completed: index + 1, total: pending.length });
      }
    } finally {
      setIsAddingAllSeasons(false);
    }
  }

  const retryAdd = () => void addToLibrary(lastAddTarget);

  return (
    <article role="listitem" className="search-result-card">
      <Card className="overflow-visible">
        <CardContent className="search-result-card-content">
          <div className="search-result-poster relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
            {hasImage && result.imageUrl ? (
              <Image src={result.imageUrl} alt="" fill unoptimized sizes="(min-width: 820px) 128px, (min-width: 560px) 104px, 72px" className="object-cover" onError={() => onImageError(result.imageUrl!)} />
            ) : (
              <div className="flex flex-col items-center gap-1 text-xs"><ImageOff className="h-5 w-5" aria-hidden="true" />{t("anime.noCover")}</div>
            )}
          </div>

          <div className="search-result-main min-w-0 space-y-2">
            <div className="space-y-1">
              <h2 className="line-clamp-2 text-[15px] font-semibold leading-5 tracking-tight sm:text-lg sm:leading-6">{result.title}</h2>
              {result.originalTitle ? <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{t("anime.originalTitle", { title: result.originalTitle })}</p> : null}
            </div>

            <button
              type="button"
              className="search-details-trigger flex min-h-11 w-full items-center gap-2 rounded-xl text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] sm:min-h-8"
              aria-expanded={showDetails}
              aria-controls={detailsId}
              onClick={() => setShowDetails((current) => !current)}
            >
              {showDetails ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="text-xs font-medium sm:text-sm">{showDetails ? t("anime.collapseDetails") : t("anime.expandDetails")}</span>
              {!showDetails ? (
                <span className="ml-auto flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-1 text-xs">
                  <Badge variant="outline" className="font-normal">{providerLabel}</Badge>
                  {platformLabel || result.episodeCount !== null ? <span className="self-center">{[platformLabel, result.episodeCount !== null ? t("anime.episodeCount", { count: result.episodeCount }) : null].filter(Boolean).join(" · ")}</span> : null}
                  {formattedDate ? <span className="self-center text-muted-foreground">{formattedDate}</span> : null}
                </span>
              ) : null}
            </button>

            {showDetails ? (
              <div id={detailsId} className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border bg-card p-3 text-sm lg:grid-cols-3">
                <SearchResultDetail label={t("search.provider")} value={providerLabel} />
                <SearchResultDetail label={t("anime.externalId")} value={result.externalId} />
                <SearchResultDetail label={t("anime.platform")} value={platformLabel} />
                <SearchResultDetail label={t("anime.episodes")} value={result.episodeCount !== null ? t("anime.episodeCount", { count: result.episodeCount }) : null} />
                <SearchResultDetail label={t("anime.airDate")} value={formattedDate} />
              </div>
            ) : null}

            <p className="search-result-summary line-clamp-3 text-sm leading-6 text-muted-foreground">{result.summary ?? t("anime.noSummary")}</p>
            <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] sm:min-h-8" aria-label={t("anime.viewOnProviderNewTab", { provider: providerLabel })}>
              {t("anime.viewOnProvider", { provider: providerLabel })}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="search-result-action flex items-start justify-end sm:items-center">
            {primaryAction ? (
              <Button type="button" className="search-card-action" disabled={primaryAction.disabled || primaryAction.loading} aria-busy={primaryAction.loading || undefined} aria-label={primaryAction.loading ? primaryAction.loadingLabel ?? primaryAction.label : primaryAction.label} onClick={primaryAction.onClick}>
                {primaryAction.loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PrimaryActionIcon className="h-4 w-4" aria-hidden="true" />}<span>{primaryAction.loading ? primaryAction.loadingLabel ?? primaryAction.label : primaryAction.label}</span>
              </Button>
            ) : isTvdbResult ? (
              <Button type="button" variant="secondary" className="search-card-action" disabled={isLoadingTvdbSeasons} aria-busy={isLoadingTvdbSeasons || undefined} aria-label={isLoadingTvdbSeasons ? t("search.loadingTvdbSeasons") : t("search.viewTvdbSeasons")} onClick={() => void openTvdbSeasons()}>
                {isLoadingTvdbSeasons ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}<span>{isLoadingTvdbSeasons ? t("search.loadingTvdbSeasons") : t("search.viewTvdbSeasons")}</span>
              </Button>
            ) : result.inLibrary && result.animeId ? (
              <Link href={`/library/${result.animeId}`} className="search-card-action search-card-action-neutral" aria-label={t("search.viewInLibrary")}><BookOpenCheck className="h-4 w-4" aria-hidden="true" /><span>{t("search.viewInLibrary")}</span></Link>
            ) : (
              <Button type="button" className="search-card-action" disabled={isAdding} aria-busy={isAdding || undefined} aria-label={isAdding ? t("search.addingToLibrary") : t("search.addToLibrary")} onClick={() => void addToLibrary()}>
                {isAdding ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}<span>{isAdding ? t("search.addingToLibrary") : t("search.addToLibrary")}</span>
              </Button>
            )}
          </div>

          {addError && !duplicateConflict ? (
            <div className="search-result-error flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <span>{addError}</span><Button type="button" variant="outline" size="sm" onClick={retryAdd}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t("search.retry")}</Button>
            </div>
          ) : null}
          <span className="sr-only" role="status" aria-live="polite">{addedAnnouncement}</span>
        </CardContent>
      </Card>

      <ModalSurface open={showTvdbSeasons && !duplicateConflict} titleId={tvdbTitleId} descriptionId={tvdbDescriptionId} busy={isAdding} panelClassName="h-[100svh] pt-[env(safe-area-inset-top)] sm:h-auto sm:max-h-[90svh] sm:max-w-3xl sm:rounded-[var(--radius-modal)] sm:pt-0" onClose={() => setShowTvdbSeasons(false)}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b bg-background/85 p-4 backdrop-blur sm:p-5">
          <div className="min-w-0 flex-1"><h2 id={tvdbTitleId} className="text-lg font-semibold tracking-tight">{t("search.tvdbSeasonsTitle")}</h2><p id={tvdbDescriptionId} className="mt-1 text-sm text-muted-foreground">{t("search.tvdbSeasonsDescription")}</p><p className="mt-3 break-words rounded-xl bg-muted/40 p-3 text-sm">{result.title}</p></div>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" data-dialog-close aria-label={t("search.closeTvdbSeasons")} disabled={isAdding} onClick={() => setShowTvdbSeasons(false)}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1" viewportClassName="h-full space-y-3 p-4">
          {isLoadingTvdbSeasons ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("search.loadingTvdbSeasons")}</p> : null}
          {tvdbSeasonsError ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive" role="alert"><span>{tvdbSeasonsError}</span><Button type="button" variant="outline" size="sm" onClick={() => { setTvdbSeasons(null); void openTvdbSeasons(); }}>{t("search.retry")}</Button></div> : null}
          {tvdbSeasons?.length === 0 ? <p className="text-sm text-muted-foreground">{t("search.tvdbSeasonsEmpty")}</p> : null}
          {addError ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><span>{addError}</span><Button type="button" variant="outline" size="sm" onClick={retryAdd}>{t("search.retry")}</Button></div> : null}
          {tvdbSeasons?.map((season) => <SeasonRow key={season.externalId} season={season} locale={locale} status={seasonStatuses[season.externalId]} disabled={isAddingAllSeasons || (isAdding && addingExternalId !== season.externalId)} onAdd={() => void addToLibrary(season)} />)}
        </ScrollArea>
        <div className="flex shrink-0 flex-col gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end">
          {isAddingAllSeasons ? <p className="mr-auto text-sm text-muted-foreground" role="status">{t("search.addAllProgress", { completed: bulkProgress.completed, total: bulkProgress.total })}</p> : null}
          <Button type="button" variant="outline" className="min-h-11" disabled={isAdding && !isAddingAllSeasons} onClick={() => { if (isAddingAllSeasons) cancelBulkRef.current = true; else setShowTvdbSeasons(false); }}>{isAddingAllSeasons ? t("search.stopAdding") : t("library.cancel")}</Button>
          <Button type="button" className="min-h-11" disabled={isAddingAllSeasons || isAdding || !tvdbSeasons?.some((season) => !season.inLibrary)} onClick={() => void addAllTvdbSeasons()}>{isAddingAllSeasons ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{t("search.addAllSeasons")}</Button>
        </div>
      </ModalSurface>

      <ModalSurface open={Boolean(duplicateConflict)} titleId={duplicateTitleId} descriptionId={duplicateDescriptionId} busy={isAdding} panelClassName="h-[100svh] pt-[env(safe-area-inset-top)] sm:h-auto sm:max-h-[90svh] sm:max-w-2xl sm:rounded-[var(--radius-modal)] sm:pt-0" onClose={() => setDuplicateConflict(null)}>
        {duplicateConflict ? <>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b bg-background/85 p-4 backdrop-blur sm:p-5">
            <div className="min-w-0 flex-1"><h2 id={duplicateTitleId} className="text-lg font-semibold tracking-tight">{t("search.duplicateAnimeTitle")}</h2><p id={duplicateDescriptionId} className="mt-1 text-sm text-muted-foreground">{t("search.duplicateAnimeDescription")}</p><p className="mt-3 break-words rounded-xl bg-muted/40 p-3 text-sm">{formatProvider(duplicateConflict.provider)} · {duplicateConflict.title}</p></div>
            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" data-dialog-close aria-label={t("search.closeDuplicateDialog")} disabled={isAdding} onClick={() => setDuplicateConflict(null)}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
          <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1" viewportClassName="h-full space-y-3 p-4">
            {addError ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{addError}</p> : null}
            {duplicateConflict.candidates.map((candidate) => (
              <div key={candidate.animeId} className="rounded-2xl border bg-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><p className="font-medium">{candidate.displayName}</p><p className="text-sm text-muted-foreground">{candidate.originalName}</p><p className="text-xs text-muted-foreground">{formatProvider(candidate.provider)} · {formatDate(candidate.airDate, locale) ?? t("anime.unknown")} · {candidate.episodeCount !== null ? t("anime.episodeCount", { count: candidate.episodeCount }) : t("anime.unknown")}</p></div><Button type="button" className="min-h-11 shrink-0" disabled={isAdding} onClick={() => void addToLibrary(duplicateTarget ?? result, { useExistingAnimeId: candidate.animeId })}>{t("search.useExistingProvider")}</Button></div></div>
            ))}
          </ScrollArea>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="min-h-11" disabled={isAdding} onClick={() => setDuplicateConflict(null)}>{t("library.cancel")}</Button><Button type="button" className="min-h-11" disabled={isAdding} onClick={() => void addToLibrary(duplicateTarget ?? result, { useCurrentProvider: true })}>{t("search.useCurrentProvider")}</Button></div>
        </> : null}
      </ModalSurface>
    </article>
  );
}

function SeasonRow({ season, locale, status, disabled, onAdd }: { season: AnimeSearchResult; locale: string; status?: SeasonStatus; disabled: boolean; onAdd: () => void }) {
  const t = useTranslations();
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="relative flex aspect-[2/3] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground sm:w-20">
            {season.imageUrl && !imageFailed ? (
              <Image
                src={season.imageUrl}
                alt=""
                fill
                unoptimized
                sizes="(min-width: 640px) 80px, 72px"
                className="object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-1 px-1 text-center text-xs">
                <ImageOff className="h-5 w-5" aria-hidden="true" />
                {t("anime.noCover")}
              </div>
            )}
          </div>
          <div className="min-w-0 py-0.5">
            <p className="font-medium">{season.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatProvider(season.provider)} · {formatDate(season.airDate, locale) ?? t("anime.unknown")} · {season.episodeCount !== null ? t("anime.episodeCount", { count: season.episodeCount }) : t("anime.unknown")}</p>
            <a className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary sm:min-h-8" href={season.url} target="_blank" rel="noreferrer" aria-label={t("anime.viewOnProviderNewTab", { provider: formatProvider(season.provider) })}>{t("anime.viewOnProvider", { provider: formatProvider(season.provider) })}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
          </div>
        </div>
        {season.inLibrary && season.animeId ? <Link href={`/library/${season.animeId}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium"><BookOpenCheck className="h-4 w-4" aria-hidden="true" />{t("search.viewInLibrary")}</Link> : <Button type="button" className="min-h-11 shrink-0" disabled={disabled || status === "pending"} aria-busy={status === "pending" || undefined} onClick={onAdd}>{status === "pending" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : status === "success" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{status === "pending" ? t("search.addingToLibrary") : t("search.addToLibrary")}</Button>}
      </div>
    </div>
  );
}

function SearchResultDetail({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations();
  return <div className="min-w-0 space-y-1"><div className="text-xs text-muted-foreground">{label}</div><div className="break-words font-medium">{value ?? t("anime.unknown")}</div></div>;
}

function formatProvider(provider: string) {
  if (provider.toLowerCase() === "tvdb") return "The TVDB";
  if (provider.toLowerCase() === "bangumi") return "Bangumi";
  return provider;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatPlatform(value: string | null, locale: string) {
  if (!value) return null;
  const labels: Record<string, [string, string]> = { tv: ["TV", "电视动画"], movie: ["Movie", "剧场版"], ova: ["OVA", "OVA"], ona: ["ONA", "网络动画"], special: ["Special", "特别篇"] };
  const label = labels[value.toLowerCase()];
  return label ? label[locale.startsWith("zh") ? 1 : 0] : value;
}

function isDuplicateConflictBody(body: unknown): body is { conflict: DuplicateAnimeConflict } {
  if (!body || typeof body !== "object") return false;
  const conflict = (body as { conflict?: unknown }).conflict;
  return Boolean(conflict && typeof conflict === "object" && Array.isArray((conflict as { candidates?: unknown }).candidates));
}
