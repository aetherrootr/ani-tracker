"use client";

import { ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getImportProviders, switchAnimeProvider } from "@/features/library/api";
import type { Anime, EpisodeConflict, ImportProvider } from "@/features/library/types";
import { searchAnime } from "@/features/search/api";
import type { AnimeSearchResult } from "@/features/search/types";

type Props = {
  open: boolean;
  anime: Anime;
  onClose: () => void;
  onSwitched: (animeId: number, previousAnimeId: number, conflicts: EpisodeConflict[]) => void;
};

export function ProviderSwitchDialog({ open, anime, onClose, onSwitched }: Props) {
  const t = useTranslations();
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  const [targetProvider, setTargetProvider] = useState<string>("");
  const [results, setResults] = useState<AnimeSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const controller = new AbortController();
    getImportProviders(controller.signal)
      .then((response) => {
        const available = response.providers.filter((provider) => provider.name !== anime.provider);
        setProviders(available);
        const nextProvider = available[0]?.name || "";
        setTargetProvider(nextProvider);
        setIsLoading(Boolean(nextProvider));
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("library.switchProviderFailed")));
    return () => controller.abort();
  }, [anime.provider, open, t]);

  useEffect(() => {
    if (!open || !targetProvider) {
      return;
    }
    const controller = new AbortController();
    searchAnime({ keyword: anime.originalName, provider: targetProvider, signal: controller.signal })
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
  }, [anime.originalName, open, targetProvider, t]);

  if (!open) {
    return null;
  }

  async function switchToResult(result: AnimeSearchResult) {
    setIsSwitching(true);
    setError(null);
    try {
      const response = await switchAnimeProvider(anime.id, result.provider, result.externalId);
      onSwitched(response.anime.id, response.previousAnimeId, response.episodeConflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.switchProviderFailed"));
    } finally {
      setIsSwitching(false);
    }
  }

  function chooseProvider(provider: string) {
    setTargetProvider(provider);
    setResults([]);
    setError(null);
    setIsLoading(true);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="provider-switch-title" onClick={onClose}>
      <div className="glass-dialog flex h-[100svh] w-full flex-col overflow-hidden border pt-[env(safe-area-inset-top)] text-foreground sm:h-auto sm:max-h-[90svh] sm:max-w-3xl sm:rounded-2xl sm:pt-0" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/70 p-4 backdrop-blur sm:p-5">
          <div>
            <h2 id="provider-switch-title" className="text-lg font-semibold tracking-tight">{t("library.switchProvider")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("library.currentProvider")}: {anime.provider} · {anime.originalName}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={t("library.cancel")} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <span className="text-sm text-muted-foreground">{t("library.targetProvider")}</span>
          {providers.map((provider) => (
            <Button key={provider.name} type="button" size="sm" variant={targetProvider === provider.name ? "default" : "outline"} disabled={isSwitching} onClick={() => chooseProvider(provider.name)}>
              {provider.label}
            </Button>
          ))}
        </div>

        {error ? <div className="border-b p-4 text-sm font-medium text-destructive">{error}</div> : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {isLoading ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("search.loading")}</p> : null}
          {!isLoading && results.length === 0 ? <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{t("library.switchProviderSearchEmpty")}</p> : null}
          {results.map((result) => (
            <div key={`${result.provider}:${result.externalId}`} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{result.provider}</Badge>
                    {result.platform ? <Badge variant="secondary">{result.platform}</Badge> : null}
                    {result.episodeCount !== null ? <Badge variant="secondary">{t("anime.episodeCount", { count: result.episodeCount })}</Badge> : null}
                    {result.airDate ? <Badge variant="secondary">{result.airDate}</Badge> : null}
                  </div>
                  <p className="font-medium">{result.title}</p>
                  {result.originalTitle ? <p className="text-sm text-muted-foreground">{result.originalTitle}</p> : null}
                  {result.summary ? <p className="line-clamp-2 text-sm text-muted-foreground">{result.summary}</p> : null}
                  <a className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={result.url} target="_blank" rel="noreferrer">
                    {t("anime.viewOnProvider", { provider: result.provider })}<ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <Button type="button" disabled={isSwitching} onClick={() => void switchToResult(result)}>{t("library.switchToProviderResult")}</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
