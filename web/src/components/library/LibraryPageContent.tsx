"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BackToTopButton } from "@/components/layout/BackToTopButton";
import { addPageScrollListener, scrollPageTo } from "@/components/layout/mobile-scroll-container";
import { Button } from "@/components/ui/button";
import {
  calculateLibraryPageSize,
  useDebouncedValue,
  useLibraryData,
  useLibraryQueryState,
} from "@/features/library/hooks";

import { LibraryAnimeCard } from "./LibraryAnimeCard";
import { LibraryPagination, SkeletonBlock } from "./LibraryPagination";
import { LibraryQuickNavigation } from "./LibraryQuickNavigation";
import { LibraryToolbar } from "./LibraryToolbar";

export function LibraryPageContent() {
  const t = useTranslations();
  const query = useLibraryQueryState();
  const [searchDraft, setSearchDraft] = useState(query.q);
  const debouncedSearch = useDebouncedValue(searchDraft);
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previousPageRef = useRef(query.page);
  const [activeAnchorKey, setActiveAnchorKey] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ key: string; run: number } | null>(null);
  const pendingAnchorKeyRef = useRef<string | null>(null);
  const preferredAnchorKeyRef = useRef<string | null>(null);
  const anchorPendingViewRef = useRef(false);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const { data, isLoading, error, retry } = useLibraryData({
    q: query.q,
    status: query.status,
    provider: query.provider,
    unwatched: query.unwatched,
    airStatus: query.airStatus,
    seasonZero: query.seasonZero,
    sort: query.sort,
    order: query.order,
    page: query.page,
    pageSize: query.pageSize,
  });
  const totalPages = data?.totalPages ?? 0;
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const navigationAnchors = useMemo(() => data?.navigationAnchors ?? [], [data?.navigationAnchors]);

  const waitForAnchorInView = useCallback((key: string, callback: () => void) => {
    const element = document.getElementById(anchorElementId(key));
    if (!element) return;
    if (isElementInView(element)) {
      callback();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      callback();
    }, { threshold: 0.2 });
    observer.observe(element);
    celebrationTimeoutRef.current = window.setTimeout(() => {
      observer.disconnect();
      callback();
    }, 900);
  }, []);

  const celebrateAnchor = useCallback((key: string) => {
    if (prefersReducedMotion()) return;
    if (celebrationTimeoutRef.current !== null) window.clearTimeout(celebrationTimeoutRef.current);

    waitForAnchorInView(key, () => {
      setCelebration((current) => ({ key, run: (current?.run ?? 0) + 1 }));
    });
  }, [waitForAnchorInView]);

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current !== null) window.clearTimeout(celebrationTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchDraft(query.q);
  }, [query.q]);

  useEffect(() => {
    if (debouncedSearch !== query.q) {
      query.update({ q: debouncedSearch, page: 1 });
    }
  }, [debouncedSearch, query]);

  useEffect(() => {
    let frameId: number | null = null;

    function syncPageSize() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updatePageSize();
      });
    }

    function updatePageSize() {
      const nextSize = calculateLibraryPageSize(gridRef.current);
      if (nextSize === query.pageSize) {
        return;
      }
      const currentOffset = Math.max(query.page - 1, 0) * query.pageSize;
      query.update({ pageSize: nextSize, page: Math.floor(currentOffset / nextSize) + 1 });
    }

    syncPageSize();
    const observer = new ResizeObserver(syncPageSize);
    if (gridRef.current) {
      observer.observe(gridRef.current);
    }
    window.addEventListener("resize", syncPageSize);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
      window.removeEventListener("resize", syncPageSize);
    };
  // query.update is intentionally omitted because the query object is recreated per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.page, query.pageSize]);

  useEffect(() => {
    if (previousPageRef.current !== query.page) {
      previousPageRef.current = query.page;
      if (pendingAnchorKeyRef.current === null) {
        if (window.innerWidth < 640) {
          scrollPageTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
          return;
        }
        listTopRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    }
  }, [query.page]);

  useEffect(() => {
    const pageAnchors = currentPageAnchors(navigationAnchors, query.page, query.pageSize);
    if (pageAnchors.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveAnchorKey(null);
      return;
    }

    const pendingAnchorKey = pendingAnchorKeyRef.current;
    const pendingAnchor = pendingAnchorKey ? pageAnchors.find((anchor) => anchor.key === pendingAnchorKey) : undefined;
    if (pendingAnchor) {
      if (!document.getElementById(anchorElementId(pendingAnchor.key))) {
        return;
      }
      pendingAnchorKeyRef.current = null;
      setActiveAnchorKey(pendingAnchor.key);
      scrollToAnchor(pendingAnchor.key);
      celebrateAnchor(pendingAnchor.key);
      return;
    }

    if (!activeAnchorKey || !pageAnchors.some((anchor) => anchor.key === activeAnchorKey)) {
      setActiveAnchorKey(pageAnchors[0]?.key ?? null);
    }
  }, [activeAnchorKey, celebrateAnchor, data?.items, data?.navigationAnchors, navigationAnchors, query.page, query.pageSize]);

  useEffect(() => {
    const anchors = currentPageAnchors(navigationAnchors, query.page, query.pageSize);
    if (anchors.length === 0) {
      return;
    }

    function updateActiveAnchor() {
      const candidates = anchors
        .map((anchor) => ({ anchor, element: document.getElementById(anchorElementId(anchor.key)) }))
        .filter((item): item is { anchor: (typeof anchors)[number]; element: HTMLElement } => item.element !== null);
      const preferredCandidate = preferredAnchorKeyRef.current
        ? candidates.find((item) => item.anchor.key === preferredAnchorKeyRef.current)
        : undefined;
      if (anchorPendingViewRef.current) {
        if (!preferredCandidate) return;
        const rect = preferredCandidate.element.getBoundingClientRect();
        if (rect.bottom > 120 && rect.top < window.innerHeight - 80) {
          anchorPendingViewRef.current = false;
        }
        setActiveAnchorKey(preferredCandidate.anchor.key);
        return;
      }
      const preferredVisible = preferredAnchorKeyRef.current
        ? candidates.find((item) => {
            if (item.anchor.key !== preferredAnchorKeyRef.current) return false;
            const rect = item.element.getBoundingClientRect();
            return rect.bottom > 120 && rect.top < window.innerHeight - 80;
          })
        : undefined;
      if (preferredVisible) {
        setActiveAnchorKey(preferredVisible.anchor.key);
        return;
      }

      const passedCandidates = candidates.filter((item) => item.element.getBoundingClientRect().top <= 140);
      const lastVisibleTop = passedCandidates.at(-1)?.element.getBoundingClientRect().top;
      const tiedCandidates = lastVisibleTop === undefined
        ? []
        : passedCandidates.filter((item) => Math.abs(item.element.getBoundingClientRect().top - lastVisibleTop) < 2);
      const preferred = preferredAnchorKeyRef.current
        ? tiedCandidates.find((item) => item.anchor.key === preferredAnchorKeyRef.current)
        : undefined;
      const current = preferred ?? tiedCandidates.find((item) => item.anchor.key === activeAnchorKey) ?? passedCandidates.at(-1) ?? candidates[0];

      if (current) {
        setActiveAnchorKey(current.anchor.key);
      }
    }

    updateActiveAnchor();
    return addPageScrollListener(updateActiveAnchor);
  }, [activeAnchorKey, navigationAnchors, query.page, query.pageSize]);

  function updatePage(page: number) {
    preferredAnchorKeyRef.current = null;
    anchorPendingViewRef.current = false;
    query.update({ page });
  }

  function handleAnchor(anchor: { key: string; page: number }) {
    preferredAnchorKeyRef.current = anchor.key;
    anchorPendingViewRef.current = true;
    if (anchor.page === query.page && document.getElementById(anchorElementId(anchor.key))) {
      pendingAnchorKeyRef.current = null;
      setActiveAnchorKey(anchor.key);
      scrollToAnchor(anchor.key);
      celebrateAnchor(anchor.key);
      return;
    }

    pendingAnchorKeyRef.current = anchor.key;
    query.update({ page: anchor.page });
  }

  return (
    <div className="space-y-6">
      <header className="page-heading-surface mx-auto max-w-3xl space-y-2 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">{t("library.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("library.title")}</h1>
      </header>

      <LibraryToolbar
        q={searchDraft}
        status={query.status}
        provider={query.provider}
        unwatched={query.unwatched}
        airStatus={query.airStatus}
        seasonZero={query.seasonZero}
        providers={data?.providers ?? []}
        sort={query.sort}
        order={query.order}
        total={total}
        busy={isLoading || query.isPending || debouncedSearch !== query.q}
        onSearchChange={setSearchDraft}
        onOptionsChange={(next) => query.update({ ...next, page: 1 })}
      />

      <div ref={listTopRef} className="scroll-mt-24" />

      {error ? (
        <div className="mx-auto max-w-5xl rounded-2xl border bg-card p-8 text-center shadow-sm">
          <p className="font-medium">{t("library.loadFailed")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-4" onClick={retry}>{t("search.retry")}</Button>
        </div>
      ) : null}

      {!error ? (
        <div className="library-results-layout mx-auto max-w-[1440px]">
          <LibraryQuickNavigation
            anchors={navigationAnchors}
            activeAnchorKey={activeAnchorKey}
            onAnchor={handleAnchor}
          />
          <section
            className="min-w-0 space-y-6"
            aria-label={t("library.resultsRegion")}
            aria-busy={isLoading || query.isPending}
          >
            {isLoading && !data ? (
              <div ref={gridRef} className="library-grid">
                {Array.from({ length: query.pageSize }).map((_, index) => (
                  <div key={index} className="library-skeleton-card rounded-2xl border bg-card p-3">
                    <SkeletonBlock className="library-skeleton-poster aspect-[2/3] w-24 shrink-0" />
                    <div className="space-y-2 p-3">
                      <SkeletonBlock className="h-4 w-4/5" />
                      <SkeletonBlock className="h-3 w-2/3" />
                      <SkeletonBlock className="h-2 w-full rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length > 0 ? (
              <div ref={gridRef} className={`library-grid transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
                {items.map((item, index) => {
                  const globalOffset = Math.max(query.page - 1, 0) * query.pageSize + index;
                  const anchor = navigationAnchors.find((candidate) => candidate.offset === globalOffset);
                  return (
                    <div
                      key={item.anime.id}
                      id={anchor ? anchorElementId(anchor.key) : undefined}
                      data-library-anchor-key={anchor?.key}
                      className="relative scroll-mt-28"
                    >
                      <LibraryAnimeCard item={item} />
                      {anchor && celebration?.key === anchor.key ? <ConfettiBurst key={`${anchor.key}-${celebration.run}`} /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">
                <p>{t("library.empty")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {query.q ? <Button type="button" variant="outline" onClick={() => setSearchDraft("")}>{t("library.clearSearch")}</Button> : null}
                  <Button type="button" variant="outline" onClick={() => query.update({ status: "all", provider: "all", unwatched: "all", airStatus: "all", seasonZero: "exclude", sort: "updatedAt", order: "desc", page: 1 })}>{t("library.resetFilters")}</Button>
                  {!query.q && query.status === "all" && query.provider === "all" && query.unwatched === "all" && query.airStatus === "all" && query.seasonZero === "exclude" ? (
                    <Link href="/search" className="interactive-surface inline-flex min-h-[38px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--accent-solid)] px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-glow)]">
                      {t("library.addAnime")}
                    </Link>
                  ) : null}
                </div>
              </div>
            )}

            <LibraryPagination
              page={query.page}
              totalPages={totalPages}
              total={total}
              pageSize={query.pageSize}
              disabled={isLoading || query.isPending}
              onPageChange={updatePage}
            />
          </section>
        </div>
      ) : null}

      <BackToTopButton />
    </div>
  );
}

function currentPageAnchors<T extends { offset: number; page: number }>(anchors: T[], page: number, pageSize: number) {
  const pageStart = Math.max(page - 1, 0) * pageSize;
  const pageEnd = pageStart + pageSize;
  return anchors.filter((anchor) => anchor.page === page && anchor.offset >= pageStart && anchor.offset < pageEnd);
}

function anchorElementId(key: string) {
  return `library-anchor-${encodeURIComponent(key)}`;
}

function scrollToAnchor(key: string) {
  document.getElementById(anchorElementId(key))?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isElementInView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 120 && rect.top < window.innerHeight - 80;
}

function ConfettiBurst() {
  const pieces = [
    [0, -132, -22, "#ff1744"], [68, -158, 18, "#00d978"], [-76, -150, -34, "#4598ff"],
    [124, -82, 44, "#ffd60a"], [-128, -88, -58, "#ff4fbd"], [40, -190, 68, "#8c63ff"],
    [-34, -184, -72, "#3edbe8"], [152, -26, 88, "#ff6b35"], [-156, -22, -96, "#9edb3d"],
    [18, -90, 120, "#ff9f0a"], [94, -126, -118, "#30d5c8"], [-98, -120, 138, "#d84cff"],
  ];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-visible" aria-hidden="true">
      <div className="library-confetti-ring absolute left-1/2 top-1/3 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="absolute left-1/2 top-1/3 h-1 w-1">
        {pieces.map(([x, y, rotate, color], index) => (
          <span
            key={index}
            className="library-confetti-piece"
            style={{
              "--confetti-x": `${x}px`,
              "--confetti-y": `${y}px`,
              "--confetti-rotate": `${rotate}deg`,
              "--confetti-color": color,
              animationDelay: `${index * 18}ms`,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
