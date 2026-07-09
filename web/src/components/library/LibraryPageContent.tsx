"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { BackToTopButton } from "@/components/layout/BackToTopButton";
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
  const celebrationTimeoutRef = useRef<number | null>(null);
  const { data, isLoading, error, retry } = useLibraryData({
    q: query.q,
    status: query.status,
    sort: query.sort,
    order: query.order,
    page: query.page,
    pageSize: query.pageSize,
  });
  const totalPages = data?.totalPages ?? 0;
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const navigationAnchors = useMemo(() => data?.navigationAnchors ?? [], [data?.navigationAnchors]);

  function celebrateAnchor(key: string) {
    if (celebrationTimeoutRef.current !== null) {
      window.clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = null;
    }

    waitForAnchorInView(key, () => {
      setCelebration((current) => ({ key, run: (current?.run ?? 0) + 1 }));
    });
  }

  function waitForAnchorInView(key: string, callback: () => void) {
    const element = document.getElementById(anchorElementId(key));
    if (!element) {
      return;
    }

    if (isElementInView(element)) {
      callback();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          callback();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(element);

    celebrationTimeoutRef.current = window.setTimeout(() => {
      observer.disconnect();
      callback();
    }, 900);
  }

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current !== null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.page, query.pageSize]);

  useEffect(() => {
    if (previousPageRef.current !== query.page) {
      previousPageRef.current = query.page;
      if (pendingAnchorKeyRef.current === null) {
        if (window.innerWidth < 640) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        listTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnchorKey, data?.items, data?.navigationAnchors, navigationAnchors, query.page, query.pageSize]);

  useEffect(() => {
    const anchors = currentPageAnchors(navigationAnchors, query.page, query.pageSize);
    if (anchors.length === 0) {
      return;
    }

    function updateActiveAnchor() {
      const candidates = anchors
        .map((anchor) => ({ anchor, element: document.getElementById(anchorElementId(anchor.key)) }))
        .filter((item): item is { anchor: (typeof anchors)[number]; element: HTMLElement } => item.element !== null);
      const preferredVisible = preferredAnchorKeyRef.current
        ? candidates.find((item) => {
            if (item.anchor.key !== preferredAnchorKeyRef.current) {
              return false;
            }
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
    window.addEventListener("scroll", updateActiveAnchor, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveAnchor);
  }, [activeAnchorKey, navigationAnchors, query.page, query.pageSize]);

  function updatePage(page: number) {
    query.update({ page });
  }

  function handleAnchor(anchor: { key: string; page: number }) {
    preferredAnchorKeyRef.current = anchor.key;
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
      <div className="mx-auto max-w-5xl space-y-2 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">{t("library.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("library.title")}</h1>
      </div>

      <LibraryToolbar
        q={searchDraft}
        status={query.status}
        sort={query.sort}
        order={query.order}
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
        <div className="relative mx-auto max-w-6xl">
          <div className="absolute left-0 top-0 bottom-0 w-0">
            <LibraryQuickNavigation
              anchors={navigationAnchors}
              activeAnchorKey={activeAnchorKey}
              onAnchor={handleAnchor}
            />
          </div>
          <main className="min-w-0 space-y-6">
            {isLoading ? (
              <div ref={gridRef} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: query.pageSize }).map((_, index) => (
                  <div key={index} className="rounded-2xl border bg-card p-3 sm:p-0">
                    <SkeletonBlock className="aspect-[2/3] w-28 sm:w-full sm:rounded-b-none" />
                    <div className="space-y-2 p-3">
                      <SkeletonBlock className="h-4 w-4/5" />
                      <SkeletonBlock className="h-3 w-2/3" />
                      <SkeletonBlock className="h-2 w-full rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length > 0 ? (
              <div ref={gridRef} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                      {anchor && celebration?.key === anchor.key ? (
                        <ConfettiBurst key={`${anchor.key}-${celebration.run}`} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">
                {t("library.empty")}
              </div>
            )}

            <LibraryPagination
              page={query.page}
              totalPages={totalPages}
              total={total}
              disabled={isLoading || query.isPending}
              onPageChange={updatePage}
            />
          </main>
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
  document.getElementById(anchorElementId(key))?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function isElementInView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 120 && rect.top < window.innerHeight - 80;
}

function ConfettiBurst() {
  const pieces = [
    [0, -132, -22, "#ff1744"],
    [68, -158, 18, "#00ff6a"],
    [-76, -150, -34, "#00a2ff"],
    [124, -82, 44, "#fff200"],
    [-128, -88, -58, "#ff00b8"],
    [40, -190, 68, "#b000ff"],
    [-34, -184, -72, "#00f7ff"],
    [152, -26, 88, "#ff2a00"],
    [-156, -22, -96, "#b6ff00"],
    [18, -90, 120, "#ff9500"],
    [94, -126, -118, "#00ffd5"],
    [-98, -120, 138, "#ff00ff"],
    [168, -130, 156, "#ffffff"],
    [-172, -136, -154, "#ffffff"],
    [132, -176, -168, "#39ff14"],
    [-138, -178, 174, "#ffea00"],
    [196, -70, 202, "#00fffb"],
    [-202, -74, -208, "#ff1493"],
    [78, -220, 234, "#ff4dff"],
    [-82, -218, -238, "#4dff00"],
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
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
