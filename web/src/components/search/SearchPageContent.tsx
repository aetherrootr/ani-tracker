"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { BackToTopButton } from "@/components/layout/BackToTopButton";
import { getPageScrollTop, scrollPageTo } from "@/components/layout/mobile-scroll-container";
import { Button } from "@/components/ui/button";
import { FloatingSearchInput } from "@/components/ui/floating-search-input";
import { ModalSurface } from "@/components/ui/modal-surface";
import { useCurrentUser } from "@/features/auth/hooks";
import { getImportProviders } from "@/features/library/api";
import { useAnimeSearch } from "@/features/search/hooks";

import { SearchResultCard } from "./SearchResultCard";
import { SearchState } from "./SearchState";

export function SearchPageContent() {
  const t = useTranslations();
  const { user } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKeyword = searchParams.get("q") ?? "";
  const urlProvider = searchParams.get("provider");
  const [provider, setProvider] = useState(urlProvider ?? user?.importProviderPreference ?? "bangumi");
  const {
    keyword, hasKeyword, isDebouncing, results, total, isLoading, isLoadingMore, error,
    paginationError, hasMore, updateKeyword, loadMore, retrySearch, submitSearch, markResultInLibrary,
  } = useAnimeSearch(provider, urlKeyword);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [providers, setProviders] = useState([{ name: "bangumi", label: "Bangumi" }]);
  const [providerLoadFailed, setProviderLoadFailed] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement | null>(null);
  const providerTriggerRef = useRef<HTMLSpanElement | null>(null);
  const providerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const urlProviderRef = useRef(urlProvider);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const canAutoLoadRef = useRef(true);
  const restoreScrollYRef = useRef<number | null>(null);
  const providerDialogTitleId = useId();
  const currentProvider = providers.find((item) => item.name === provider);
  const providerLabel = currentProvider?.label ?? provider;

  function replaceUrl(nextKeyword: string, nextProvider = provider) {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = nextKeyword.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    if (nextProvider) params.set("provider", nextProvider);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  useEffect(() => {
    const trimmed = keyword.trim();
    if (trimmed === urlKeyword.trim()) return;
    const timer = window.setTimeout(() => replaceUrl(keyword), 300);
    return () => window.clearTimeout(timer);
    // URL parameters are intentionally updated from the current input snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, urlKeyword]);

  useEffect(() => {
    if (urlProviderRef.current === urlProvider) return;
    urlProviderRef.current = urlProvider;
    if (urlProvider) {
      // Browser navigation restores the selected search scope.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProvider(urlProvider);
    }
  }, [urlProvider]);

  function loadProviders() {
    const controller = new AbortController();
    getImportProviders(controller.signal)
      .then((response) => {
        setProviderLoadFailed(false);
        if (response.providers.length === 0) return;
        setProviders(response.providers);
        const requested = urlProvider ?? user?.importProviderPreference;
        const next = requested && response.providers.some((item) => item.name === requested)
          ? requested
          : response.providers[0].name;
        setProvider(next);
        if (next !== urlProvider) replaceUrl(keyword, next);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setProviderLoadFailed(true);
      });
    return controller;
  }

  useEffect(() => {
    const controller = loadProviders();
    return () => controller.abort();
    // Provider discovery runs when the authenticated preference becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.importProviderPreference]);

  useEffect(() => {
    canAutoLoadRef.current = true;
    restoreScrollYRef.current = null;
  }, [keyword, provider]);

  function selectProvider(nextProvider: string) {
    setProvider(nextProvider);
    replaceUrl(keyword, nextProvider);
    setIsProviderDialogOpen(false);
    setIsProviderDropdownOpen(false);
    requestAnimationFrame(() => providerTriggerRef.current?.querySelector("button")?.focus());
  }

  function openProviderPicker() {
    if (window.matchMedia("(min-width: 768px) and (any-hover: hover) and (any-pointer: fine)").matches) {
      setIsProviderDropdownOpen(true);
    } else {
      setIsProviderDialogOpen(true);
    }
  }

  useEffect(() => {
    if (!isProviderDropdownOpen) return;
    const activeIndex = Math.max(0, providers.findIndex((item) => item.name === provider));
    const frame = requestAnimationFrame(() => providerOptionRefs.current[activeIndex]?.focus());

    function handlePointerDown(event: PointerEvent) {
      if (!providerDropdownRef.current?.contains(event.target as Node)) setIsProviderDropdownOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      const currentIndex = providerOptionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
      let nextIndex: number | null = null;
      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % providers.length;
      if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + providers.length) % providers.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = providers.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        providerOptionRefs.current[nextIndex]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setIsProviderDropdownOpen(false);
        providerTriggerRef.current?.querySelector("button")?.focus();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderDropdownOpen, provider, providers]);

  useLayoutEffect(() => {
    if (restoreScrollYRef.current === null) return;
    scrollPageTo({ top: restoreScrollYRef.current });
    restoreScrollYRef.current = null;
  }, [results.length]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore || isLoading || isLoadingMore || error || paginationError || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      if (!entry.isIntersecting) {
        canAutoLoadRef.current = true;
      } else if (canAutoLoadRef.current) {
        canAutoLoadRef.current = false;
        restoreScrollYRef.current = getPageScrollTop();
        void loadMore();
      }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [error, hasMore, isLoading, isLoadingMore, loadMore, paginationError]);

  function handleLoadMore() {
    restoreScrollYRef.current = getPageScrollTop();
    void loadMore();
  }

  const hasResultCards = results.length > 0;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <header className="page-heading-surface">
        <h1 className="text-3xl font-semibold tracking-tight">{t("search.title")}</h1>
      </header>

      <FloatingSearchInput
        id="anime-search"
        type="search"
        value={keyword}
        onValueChange={updateKeyword}
        onKeyDown={(event) => {
          if ((event.nativeEvent as KeyboardEvent).isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            submitSearch();
            replaceUrl(event.currentTarget.value);
          } else if (event.key === "Escape" && keyword) {
            event.preventDefault();
            updateKeyword("");
            replaceUrl("");
          }
        }}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        aria-describedby="search-results-summary"
        autoComplete="off"
        leading={(
          <>
            <Button
              type="button"
              variant="outline"
              className="h-11 max-w-[7.5rem] shrink-0 gap-1.5 rounded-full px-2.5 md:hidden"
              aria-label={t("search.chooseProviderCurrent", { provider: providerLabel })}
              aria-haspopup="dialog"
              aria-expanded={isProviderDialogOpen}
              onClick={() => setIsProviderDialogOpen(true)}
            >
              <span className="truncate text-xs font-semibold">{providerLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Button>
            <Search className="ml-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div ref={providerDropdownRef} className="relative hidden items-center gap-2 md:flex">
              <span ref={providerTriggerRef} className="contents">
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-32 justify-between rounded-full px-3 text-xs"
                aria-label={t("search.chooseProviderCurrent", { provider: providerLabel })}
                aria-haspopup="menu"
                aria-expanded={isProviderDropdownOpen}
                onClick={() => setIsProviderDropdownOpen((current) => !current)}
              >
                {providerLabel}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              </span>
              {isProviderDropdownOpen ? (
                <div className="glass-dialog absolute left-0 top-full mt-2 min-w-full overflow-hidden rounded-2xl border p-1 text-foreground shadow-lg" role="menu" aria-label={t("search.chooseProvider")}>
                  {providers.map((item, index) => (
                    <button
                      ref={(element) => { providerOptionRefs.current[index] = element; }}
                      key={item.name}
                      type="button"
                      role="menuitemradio"
                      aria-checked={provider === item.name}
                      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                      onClick={() => selectProvider(item.name)}
                    >
                      <span>{item.label}</span>{provider === item.name ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
      >
        {keyword ? (
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-full" aria-label={t("search.clearSearch")} onClick={() => { updateKeyword(""); replaceUrl(""); }}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </FloatingSearchInput>

      <ModalSurface
        open={isProviderDialogOpen}
        titleId={providerDialogTitleId}
        panelClassName="mt-auto max-h-[min(80svh,32rem)] rounded-t-[var(--radius-modal)] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 md:hidden"
        initialFocusSelector="[aria-checked='true']"
        onClose={() => setIsProviderDialogOpen(false)}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={providerDialogTitleId} className="font-semibold tracking-tight">{t("search.chooseProvider")}</h2>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-xl" data-dialog-close aria-label={t("search.closeProviderSettings")} onClick={() => setIsProviderDialogOpen(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 space-y-2 overflow-y-auto" role="radiogroup" aria-labelledby={providerDialogTitleId}>
          {providers.map((item) => (
            <button key={item.name} type="button" role="radio" aria-checked={provider === item.name} className="flex min-h-11 w-full items-center justify-between rounded-xl border bg-muted/40 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" onClick={() => selectProvider(item.name)}>
              <span className="font-medium">{item.label}</span>
              {provider === item.name ? <span className="inline-flex items-center gap-1.5 text-sm text-primary"><Check className="h-4 w-4" aria-hidden="true" />{t("search.currentProvider")}</span> : null}
            </button>
          ))}
        </div>
      </ModalSurface>

      {providerLoadFailed ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground" role="status">
          <span>{t("search.providerLoadFailed")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { setProviderLoadFailed(false); loadProviders(); }}>{t("search.retry")}</Button>
        </div>
      ) : null}

      <SearchState
        hasKeyword={hasKeyword}
        error={error}
        isLoading={isLoading || isDebouncing}
        total={total}
        resultCount={results.length}
        keyword={keyword.trim()}
        provider={providerLabel}
        onRetry={retrySearch}
        onClear={() => { updateKeyword(""); replaceUrl(""); }}
        onChooseProvider={openProviderPicker}
      />

      <section
        aria-label={t("search.resultsLabel")}
        aria-busy={isLoading || isLoadingMore || isDebouncing}
        aria-describedby="search-results-summary"
        tabIndex={-1}
        className="scroll-mt-32 outline-none"
      >
        <span id="search-results-summary" className="sr-only" role="status" aria-live="polite">
          {hasResultCards ? t("search.resultSummary", { total, resultCount: results.length }) : ""}
        </span>
        {hasResultCards ? (
          <div className="space-y-4">
            <div className="search-results-list grid gap-4" role="list">
              {results.map((result) => (
                <SearchResultCard key={`${result.provider}:${result.externalId}`} result={result} imageFailed={Boolean(result.imageUrl && failedImageUrls.has(result.imageUrl))} onImageError={(url) => setFailedImageUrls((current) => new Set(current).add(url))} onLibraryAdded={markResultInLibrary} />
              ))}
            </div>
            <div ref={loadMoreRef} className="min-h-1" aria-hidden="true" />
            <div className="content-status-surface flex min-h-12 flex-col items-center justify-center gap-2" role="status" aria-live="polite">
              {paginationError ? (
                <><p className="text-sm text-destructive">{paginationError}</p><Button type="button" variant="outline" className="min-h-11" onClick={handleLoadMore}>{t("search.retryLoad")}</Button></>
              ) : hasMore ? (
                <Button type="button" variant="outline" className="min-h-11" disabled={isLoadingMore} aria-busy={isLoadingMore || undefined} onClick={handleLoadMore}>
                  {isLoadingMore ? t("search.loadingMore") : t("search.loadMoreCount", { resultCount: results.length, total })}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">{t("search.allLoaded")}</p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <BackToTopButton />
    </div>
  );
}
