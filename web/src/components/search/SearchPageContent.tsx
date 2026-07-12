"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { BackToTopButton } from "@/components/layout/BackToTopButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FloatingSearchInput } from "@/components/ui/floating-search-input";
import { useCurrentUser } from "@/features/auth/hooks";
import { getImportProviders } from "@/features/library/api";
import { useAnimeSearch } from "@/features/search/hooks";

import { SearchResultCard } from "./SearchResultCard";
import { SearchState } from "./SearchState";

export function SearchPageContent() {
  const t = useTranslations();
  const { user } = useCurrentUser();
  const [provider, setProvider] = useState(user?.importProviderPreference ?? "bangumi");
  const {
    keyword,
    hasKeyword,
    results,
    total,
    isLoading,
    isLoadingMore,
    error,
    paginationError,
    hasMore,
    updateKeyword,
    loadMore,
    retrySearch,
    markResultInLibrary,
  } = useAnimeSearch(provider);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [providers, setProviders] = useState([{ name: "bangumi", label: "Bangumi" }]);
  const providerDropdownRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const canAutoLoadRef = useRef(true);
  const restoreScrollYRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getImportProviders(controller.signal)
      .then((response) => {
        if (response.providers.length > 0) {
          setProviders(response.providers);
          const preferredProvider = user?.importProviderPreference;
          const nextProvider = preferredProvider && response.providers.some((item) => item.name === preferredProvider)
            ? preferredProvider
            : response.providers[0].name;
          setProvider(nextProvider);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [user?.importProviderPreference]);

  useEffect(() => {
    canAutoLoadRef.current = true;
  }, [keyword, provider]);

  function selectProvider(nextProvider: string) {
    setProvider(nextProvider);
    setIsProviderDialogOpen(false);
    setIsProviderDropdownOpen(false);
  }

  useEffect(() => {
    if (!isProviderDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProviderDialogOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderDialogOpen]);

  useEffect(() => {
    if (!isProviderDropdownOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (providerDropdownRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsProviderDropdownOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProviderDropdownOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderDropdownOpen]);

  useLayoutEffect(() => {
    if (restoreScrollYRef.current === null) {
      return;
    }

    window.scrollTo({ top: restoreScrollYRef.current });
    restoreScrollYRef.current = null;
  }, [results.length]);

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;

    if (!loadMoreElement || !hasMore || isLoading || isLoadingMore || error || paginationError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry) {
          return;
        }

        if (!entry.isIntersecting) {
          canAutoLoadRef.current = true;
          return;
        }

        if (canAutoLoadRef.current) {
          canAutoLoadRef.current = false;
          restoreScrollYRef.current = window.scrollY;
          loadMore();
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [error, hasMore, isLoading, isLoadingMore, loadMore, paginationError]);

  function handleImageError(imageUrl: string) {
    setFailedImageUrls((current) => new Set(current).add(imageUrl));
  }

  function handleSearchAction() {
    if (paginationError) {
      handleLoadMore();
      return;
    }

    retrySearch();
  }

  function handleLoadMore() {
    restoreScrollYRef.current = window.scrollY;
    loadMore();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("search.title")}</h1>
      </div>

      <FloatingSearchInput
        id="anime-search"
        value={keyword}
        onChange={(event) => updateKeyword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleSearchAction();
          }
        }}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        autoComplete="off"
        leading={(
          <>
            <Button
              type="button"
              variant="ghost"
              className="h-10 gap-2 rounded-full px-3 md:hidden"
              onClick={() => setIsProviderDialogOpen(true)}
            >
              <Badge variant="secondary">{provider}</Badge>
            </Button>
            <div ref={providerDropdownRef} className="relative hidden h-10 items-center gap-2 rounded-full px-3 md:flex">
              <span className="text-sm text-muted-foreground">{t("search.provider")}</span>
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-2 rounded-full px-3 text-xs"
                aria-haspopup="menu"
                aria-expanded={isProviderDropdownOpen}
                onClick={() => setIsProviderDropdownOpen((current) => !current)}
              >
                {provider}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {isProviderDropdownOpen ? (
                <div className="glass-dialog absolute left-3 top-full z-40 mt-2 w-44 overflow-hidden rounded-2xl border p-1 text-foreground shadow-lg" role="menu">
                  {providers.map((item) => {
                    const active = provider === item.name;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                        onClick={() => selectProvider(item.name)}
                      >
                        <span>{item.label}</span>
                        {active ? <Check className="h-4 w-4 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        )}
      />

      {isProviderDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-background/80 p-4 backdrop-blur-sm md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-dialog-title"
          onClick={() => setIsProviderDialogOpen(false)}
        >
          <div
            className="glass-dialog w-full rounded-2xl border p-4 md:max-w-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="provider-dialog-title" className="font-semibold tracking-tight">
                  {t("search.chooseProvider")}
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("search.closeProviderSettings")}
                onClick={() => setIsProviderDialogOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {providers.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border bg-muted/40 px-4 py-3 text-left"
                  onClick={() => selectProvider(item.name)}
                >
                  <span className="font-medium">{item.label}</span>
                  {provider === item.name ? <Badge variant="secondary">{t("search.currentProvider")}</Badge> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <SearchState
        hasKeyword={hasKeyword}
        error={error}
        isLoading={isLoading}
        total={total}
        resultCount={results.length}
      />

      {results.length > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-4">
            {results.map((result) => (
              <SearchResultCard
                key={`${result.provider}:${result.externalId}`}
                result={result}
                imageFailed={Boolean(
                  result.imageUrl && failedImageUrls.has(result.imageUrl),
                )}
                onImageError={handleImageError}
                onLibraryAdded={markResultInLibrary}
              />
            ))}
          </div>

          <div ref={loadMoreRef} className="min-h-1" />

          {isLoadingMore ? (
            <div className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">
              {t("search.loadingMore")}
            </div>
          ) : null}

          {paginationError ? (
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{paginationError}</span>
              <Button type="button" variant="outline" size="sm" onClick={handleLoadMore}>
                {t("search.retryLoad")}
              </Button>
            </div>
          ) : null}

          {!hasMore && !isLoadingMore ? (
            <div className="text-center text-sm text-muted-foreground">{t("search.allLoaded")}</div>
          ) : null}
        </div>
      ) : null}

      <BackToTopButton />
    </div>
  );
}
