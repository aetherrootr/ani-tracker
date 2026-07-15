"use client";

import { Lock, Search, Unlock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FloatingSearchInput } from "@/components/ui/floating-search-input";
import { SearchResultCard } from "@/components/search/SearchResultCard";
import { getImportProviders, switchAnimeProvider, updateMetadataSource } from "@/features/library/api";
import type { Anime, AnimeProgress, EpisodeConflict, ImportProvider, MetadataSnapshot } from "@/features/library/types";
import { getTvdbSeasons, searchAnime } from "@/features/search/api";
import type { AnimeSearchResult } from "@/features/search/types";
import { ApiError } from "@/lib/api-client";

type Props = {
  open: boolean;
  anime: Anime;
  metadataSource: string;
  metadataSnapshot: MetadataSnapshot | null;
  onClose: () => void;
  onSwitched: (animeId: number, previousAnimeId: number, conflicts: EpisodeConflict[]) => void;
  onMetadataSourceChanged: (progress: AnimeProgress, metadataSnapshot: MetadataSnapshot | null) => void;
};

type PendingProviderSwitch = {
  result: AnimeSearchResult;
  conflicts: EpisodeConflict[];
};

export function ProviderSwitchDialog({ open, anime, metadataSource, metadataSnapshot, onClose, onSwitched, onMetadataSourceChanged }: Props) {
  const t = useTranslations();
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  const [targetProvider, setTargetProvider] = useState<string>("");
  const [results, setResults] = useState<AnimeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState(anime.originalName);
  const [isSearchLocked, setIsSearchLocked] = useState(true);
  const [confirmUnlockOpen, setConfirmUnlockOpen] = useState(false);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [switchingExternalId, setSwitchingExternalId] = useState<string | null>(null);
  const [tvdbSeasonTarget, setTvdbSeasonTarget] = useState<AnimeSearchResult | null>(null);
  const [tvdbSeasons, setTvdbSeasons] = useState<AnimeSearchResult[]>([]);
  const [isLoadingTvdbSeasons, setIsLoadingTvdbSeasons] = useState(false);
  const [tvdbSeasonsError, setTvdbSeasonsError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingProviderSwitch | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    getImportProviders(controller.signal)
      .then((response) => {
        const upstreamProviders = metadataSource === "local_snapshot" ? response.providers : response.providers.filter((provider) => provider.name !== anime.provider);
        const available = [...upstreamProviders, { name: "local", label: t("library.localSnapshotProvider") }];
        setProviders(available);
        const nextProvider = available[0]?.name || "";
        setTargetProvider(nextProvider);
        setIsLoading(Boolean(nextProvider) && nextProvider !== "local");
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("library.switchProviderFailed")));
    return () => controller.abort();
  }, [anime.provider, metadataSource, open, t]);

  useEffect(() => {
    const keyword = searchKeyword.trim();
    if (!open || !targetProvider || targetProvider === "local" || !keyword) {
      return;
    }
    const controller = new AbortController();
    searchAnime({ keyword, provider: targetProvider, signal: controller.signal })
      .then((response) => setResults(response.results))
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : t("library.switchProviderFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });
    return () => controller.abort();
  }, [open, searchKeyword, targetProvider, t]);

  if (!open) {
    return null;
  }

  async function switchToResult(result: AnimeSearchResult) {
    if (result.provider === "tvdb") {
      await openTvdbSeasonPicker(result);
      return;
    }
    await switchToProviderResult(result);
  }

  async function switchToProviderResult(result: AnimeSearchResult, confirm = false) {
    setIsSwitching(true);
    setSwitchingExternalId(result.externalId);
    setError(null);
    try {
      const response = await switchAnimeProvider(anime.id, result.provider, result.externalId, confirm);
      onSwitched(response.anime.id, response.previousAnimeId, response.episodeConflicts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isProviderSwitchConflictBody(err.body)) {
        setPendingSwitch({ result, conflicts: err.body.episodeConflicts });
        return;
      }
      setError(err instanceof Error ? err.message : t("library.switchProviderFailed"));
    } finally {
      setIsSwitching(false);
      setSwitchingExternalId(null);
    }
  }

  async function continuePendingSwitch() {
    if (!pendingSwitch) {
      return;
    }
    await switchToProviderResult(pendingSwitch.result, true);
    setPendingSwitch(null);
  }

  async function switchToLocalSnapshot() {
    setIsSwitching(true);
    setError(null);
    try {
      const response = await updateMetadataSource(anime.id, "local_snapshot");
      onMetadataSourceChanged(response.progress, response.metadataSnapshot);
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.switchProviderFailed"));
    } finally {
      setIsSwitching(false);
    }
  }

  async function openTvdbSeasonPicker(result: AnimeSearchResult) {
    setTvdbSeasonTarget(result);
    setTvdbSeasons([]);
    setTvdbSeasonsError(null);
    setIsLoadingTvdbSeasons(true);
    try {
      const response = await getTvdbSeasons(result.externalId);
      setTvdbSeasons(response.results);
    } catch (err) {
      setTvdbSeasonsError(err instanceof Error ? err.message : t("library.tvdbSeasonsFailed"));
    } finally {
      setIsLoadingTvdbSeasons(false);
    }
  }

  function chooseProvider(provider: string) {
    setTargetProvider(provider);
    setResults([]);
    setError(null);
    setIsLoading(provider !== "local");
    setTvdbSeasonTarget(null);
    setTvdbSeasons([]);
    setTvdbSeasonsError(null);
  }

  function closeDialog() {
    setSearchKeyword(anime.originalName);
    setIsSearchLocked(true);
    setConfirmUnlockOpen(false);
    setFailedImageUrls(new Set());
    setTvdbSeasonTarget(null);
    setTvdbSeasons([]);
    setTvdbSeasonsError(null);
    setPendingSwitch(null);
    onClose();
  }

  function updateSearchKeyword(value: string) {
    setSearchKeyword(value);
    if (!value.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }
    if (targetProvider) {
      setResults([]);
      setError(null);
      setIsLoading(true);
    }
  }

  function handleImageError(imageUrl: string) {
    setFailedImageUrls((current) => new Set(current).add(imageUrl));
  }

  function toggleSearchLock() {
    if (isSearchLocked) {
      setConfirmUnlockOpen(true);
      return;
    }
    setIsSearchLocked(true);
  }

  function confirmUnlockSearch() {
    setIsSearchLocked(false);
    setConfirmUnlockOpen(false);
  }

  return (
    <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-switch-title" onClick={closeDialog}>
      <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-3xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/70 p-4 backdrop-blur sm:p-5">
          <div>
            <h2 id="provider-switch-title" className="text-lg font-semibold tracking-tight">{t("library.switchProvider")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("library.currentProvider")}: {anime.provider} · {anime.originalName}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={t("library.cancel")} onClick={closeDialog}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 border-b p-4">
          <FloatingSearchInput
            id="provider-switch-search"
            value={searchKeyword}
            onChange={(event) => updateSearchKeyword(event.target.value)}
            placeholder={t("library.switchProviderSearchPlaceholder")}
            aria-label={t("library.switchProviderSearchPlaceholder")}
            autoComplete="off"
            disabled={isSearchLocked || isSwitching}
            shellClassName="static max-w-none"
            barClassName={isSearchLocked ? "bg-muted/45" : undefined}
            leading={<Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />}
          >
            <button type="button" role="switch" aria-checked={isSearchLocked} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50" disabled={isSwitching} onClick={toggleSearchLock}>
              {isSearchLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              <span className="hidden sm:inline">{isSearchLocked ? t("library.searchLocked") : t("library.searchUnlocked")}</span>
            </button>
          </FloatingSearchInput>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("library.targetProvider")}</span>
            {providers.map((provider) => (
              <Button key={provider.name} type="button" size="sm" variant={targetProvider === provider.name ? "default" : "outline"} disabled={isSwitching} onClick={() => chooseProvider(provider.name)}>
                {provider.label}
              </Button>
            ))}
          </div>
        </div>

        {error ? <div className="border-b p-4 text-sm font-medium text-destructive">{error}</div> : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {targetProvider === "local" ? (
            <div className="rounded-2xl border bg-card p-4">
              <div className="space-y-1">
                <p className="font-semibold">{metadataSnapshot ? t("library.useLocalSnapshot") : t("library.createLocalSnapshot")}</p>
                <p className="text-sm text-muted-foreground">{t("library.localSnapshotDescription")}</p>
                {metadataSnapshot ? (
                  <p className="text-sm text-muted-foreground">
                    {metadataSnapshot.sourceTitle} · {metadataSnapshot.sourceProvider} · {t("library.relatedAnimeEpisodeCount", { count: metadataSnapshot.episodeCount })}
                  </p>
                ) : null}
              </div>
              <Button type="button" className="mt-4" disabled={isSwitching} onClick={() => void switchToLocalSnapshot()}>
                {isSwitching ? t("library.switchingProvider") : metadataSnapshot ? t("library.useLocalSnapshot") : t("library.createLocalSnapshot")}
              </Button>
            </div>
          ) : null}
          {isLoading ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("search.loading")}</p> : null}
          {targetProvider !== "local" && !isLoading && results.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.switchProviderSearchEmpty")}</p> : null}
          {targetProvider !== "local" ? results.map((result) => (
            <SearchResultCard
              key={`${result.provider}:${result.externalId}`}
              result={result}
              imageFailed={Boolean(result.imageUrl && failedImageUrls.has(result.imageUrl))}
              onImageError={handleImageError}
              primaryAction={{
                label: result.provider === "tvdb" ? t("library.viewSeasons") : t("library.switchToProviderResult"),
                loadingLabel: t("library.switchingProvider"),
                icon: result.provider === "tvdb" ? "eye" : "shuffle",
                disabled: isSwitching,
                loading: switchingExternalId === result.externalId,
                onClick: () => void switchToResult(result),
              }}
            />
          )) : null}
        </div>
      </div>
      {confirmUnlockOpen ? (
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-[90] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-switch-unlock-title" onClick={() => setConfirmUnlockOpen(false)}>
          <div className="glass-dialog flex w-full flex-col justify-between border p-5 text-foreground sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div>
              <h3 id="provider-switch-unlock-title" className="text-lg font-semibold tracking-tight">{t("library.unlockSearchTitle")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("library.unlockSearchDescription")}</p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setConfirmUnlockOpen(false)}>{t("library.cancel")}</Button>
              <Button type="button" onClick={confirmUnlockSearch}>{t("library.confirmUnlockSearch")}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {tvdbSeasonTarget ? (
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-[90] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-switch-tvdb-seasons-title" onClick={() => setTvdbSeasonTarget(null)}>
          <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-3xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/70 p-4 backdrop-blur sm:p-5">
              <div>
                <h2 id="provider-switch-tvdb-seasons-title" className="text-lg font-semibold tracking-tight">{t("library.chooseTvdbSeasonTitle")}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t("library.chooseTvdbSeasonDescription")}</p>
                <p className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">{tvdbSeasonTarget.title}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={t("library.cancel")} onClick={() => setTvdbSeasonTarget(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {isLoadingTvdbSeasons ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("search.loadingTvdbSeasons")}</p> : null}
              {tvdbSeasonsError ? <p className="rounded-2xl border bg-card p-4 text-sm font-medium text-destructive">{tvdbSeasonsError}</p> : null}
              {!isLoadingTvdbSeasons && !tvdbSeasonsError && tvdbSeasons.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.tvdbSeasonsEmpty")}</p> : null}
              {tvdbSeasons.map((season) => (
                <SearchResultCard
                  key={`${season.provider}:${season.externalId}`}
                  result={season}
                  imageFailed={Boolean(season.imageUrl && failedImageUrls.has(season.imageUrl))}
                  onImageError={handleImageError}
                  primaryAction={{
                    label: t("library.switchToTvdbSeason"),
                    loadingLabel: t("library.switchingProvider"),
                    icon: "shuffle",
                    disabled: isSwitching,
                    loading: switchingExternalId === season.externalId,
                    onClick: () => void switchToProviderResult(season),
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {pendingSwitch ? (
        <div className="mobile-fixed-below-top-nav fixed inset-0 z-[100] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-switch-conflicts-title" onClick={() => setPendingSwitch(null)}>
          <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-2xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
            <div className="border-b p-5">
              <h2 id="provider-switch-conflicts-title" className="text-lg font-semibold tracking-tight">{t("library.switchProviderEpisodeConflictsTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("library.switchProviderPreflightConflictsDescription")}</p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {pendingSwitch.conflicts.map((conflict) => (
                <div key={conflict.episodeId} className="rounded-2xl border bg-card p-4">
                  <p className="font-medium">{t("library.conflictEpisode", { episode: conflict.episodeNumber })}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{conflict.displayName || t("anime.unknown")}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("library.conflictHiddenAfterSwitch")}
                    {conflict.watchedAt ? ` · ${t("library.conflictWatchedAt", { time: formatDateTime(conflict.watchedAt) })}` : ""}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={isSwitching} onClick={() => setPendingSwitch(null)}>{t("library.cancel")}</Button>
              <Button type="button" variant="outline" disabled={isSwitching} onClick={() => void switchToLocalSnapshot()}>{t("library.useLocalSnapshot")}</Button>
              <Button type="button" disabled={isSwitching} onClick={() => void continuePendingSwitch()}>{isSwitching ? t("library.switchingProvider") : t("library.continueProviderSwitch")}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isProviderSwitchConflictBody(value: unknown): value is { episodeConflicts: EpisodeConflict[] } {
  if (!value || typeof value !== "object" || !("episodeConflicts" in value)) {
    return false;
  }
  const conflicts = (value as { episodeConflicts?: unknown }).episodeConflicts;
  return Array.isArray(conflicts);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
