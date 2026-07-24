"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { getMobileScrollContainer, getPageScrollTop } from "./mobile-scroll-container";

const HISTORY_ENTRY_KEY = "__aniTrackerHistoryEntry";
const SCROLL_STORAGE_PREFIX = "ani-tracker-scroll:";
const SCROLL_STORAGE_INDEX_KEY = "ani-tracker-scroll:index";
const MAX_STORED_SCROLL_ENTRIES = 100;
const scrollPositions = new Map<string, number>();

type AppHistoryState = Record<string, unknown> & {
  [HISTORY_ENTRY_KEY]?: string;
};

export function MobileScrollRestorer() {
  const pathname = usePathname();
  const [historyRevision, setHistoryRevision] = useState(0);
  const locationKey = `${pathname}:${historyRevision}`;
  const popNavigationRef = useRef(isBackForwardPageLoad());
  const currentEntryIdRef = useRef<string | null>(null);
  const currentPathnameRef = useRef<string | null>(null);
  const preSavedEntryIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    window.history.scrollRestoration = "manual";

    const currentEntryId = currentEntryIdRef.current;
    if (currentEntryId && getHistoryEntryId() !== currentEntryId) {
      originalReplaceState(withHistoryEntryId(window.history.state, currentEntryId), "");
    }

    window.history.pushState = (state, unused, url) => {
      const outgoingEntryId = getHistoryEntryId();
      if (outgoingEntryId) {
        storeScrollPosition(outgoingEntryId, getPageScrollTop());
        if (outgoingEntryId === currentEntryIdRef.current) {
          preSavedEntryIdsRef.current.add(outgoingEntryId);
        }
      }
      originalPushState(withHistoryEntryId(state, createHistoryEntryId()), unused, url);
      if (window.location.pathname === currentPathnameRef.current) {
        setHistoryRevision((current) => current + 1);
      }
    };
    window.history.replaceState = (state, unused, url) => {
      originalReplaceState(withHistoryEntryId(state, getHistoryEntryId() ?? createHistoryEntryId()), unused, url);
    };

    function handlePopState() {
      popNavigationRef.current = true;
      if (window.location.pathname === currentPathnameRef.current) {
        setHistoryRevision((current) => current + 1);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useLayoutEffect(() => {
    const isPopNavigation = popNavigationRef.current;
    const entryId = ensureHistoryEntryId();
    const samePathname = currentPathnameRef.current === pathname;
    currentEntryIdRef.current = entryId;
    currentPathnameRef.current = pathname;
    const restorePosition = isPopNavigation ? getStoredScrollPosition(entryId) : undefined;
    const preSavedEntryIds = preSavedEntryIdsRef.current;
    popNavigationRef.current = false;
    let stopRestoring: () => void = () => {};

    function resetScroll() {
      getMobileScrollContainer()?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }

    if (!isPopNavigation && samePathname) {
      // Same-page push/replace updates preserve their feature-specific scrolling.
    } else if (restorePosition === undefined) {
      resetScroll();
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(resetScroll);
        stopRestoring = () => cancelAnimationFrame(secondFrame);
      });
      stopRestoring = () => cancelAnimationFrame(firstFrame);
    } else {
      stopRestoring = restoreScrollPosition(restorePosition);
    }

    return () => {
      stopRestoring();
      if (!preSavedEntryIds.delete(entryId)) {
        storeScrollPosition(entryId, getPageScrollTop());
      }
    };
  }, [locationKey, pathname]);

  return null;
}

function ensureHistoryEntryId() {
  const state = (window.history.state ?? {}) as AppHistoryState;
  const existing = state[HISTORY_ENTRY_KEY];
  if (existing) return existing;

  const entryId = createHistoryEntryId();
  window.history.replaceState({ ...state, [HISTORY_ENTRY_KEY]: entryId }, "");
  return entryId;
}

function getHistoryEntryId() {
  return ((window.history.state ?? {}) as AppHistoryState)[HISTORY_ENTRY_KEY] ?? null;
}

function createHistoryEntryId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isBackForwardPageLoad() {
  if (typeof performance === "undefined") return false;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === "back_forward";
}

function withHistoryEntryId(state: unknown, entryId: string): AppHistoryState {
  const nextState = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return { ...nextState, [HISTORY_ENTRY_KEY]: entryId };
}

function storeScrollPosition(entryId: string, top: number) {
  scrollPositions.delete(entryId);
  scrollPositions.set(entryId, top);
  while (scrollPositions.size > MAX_STORED_SCROLL_ENTRIES) {
    const oldestEntryId = scrollPositions.keys().next().value;
    if (!oldestEntryId) break;
    scrollPositions.delete(oldestEntryId);
  }
  try {
    const storedIndex = JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_INDEX_KEY) ?? "[]") as unknown;
    const entryIds = Array.isArray(storedIndex) ? storedIndex.filter((value): value is string => typeof value === "string" && value !== entryId) : [];
    entryIds.push(entryId);
    const expiredEntryIds = entryIds.splice(0, Math.max(entryIds.length - MAX_STORED_SCROLL_ENTRIES, 0));
    for (const expiredEntryId of expiredEntryIds) sessionStorage.removeItem(`${SCROLL_STORAGE_PREFIX}${expiredEntryId}`);
    sessionStorage.setItem(`${SCROLL_STORAGE_PREFIX}${entryId}`, String(top));
    sessionStorage.setItem(SCROLL_STORAGE_INDEX_KEY, JSON.stringify(entryIds));
  } catch {
    // In-memory restoration remains available when storage is restricted.
  }
}

function getStoredScrollPosition(entryId: string) {
  const inMemory = scrollPositions.get(entryId);
  if (inMemory !== undefined) return inMemory;
  try {
    const value = sessionStorage.getItem(`${SCROLL_STORAGE_PREFIX}${entryId}`);
    if (value === null) return undefined;
    const stored = Number(value);
    return Number.isFinite(stored) && stored >= 0 ? stored : undefined;
  } catch {
    return undefined;
  }
}

function restoreScrollPosition(top: number) {
  const container = getMobileScrollContainer();
  if (!container || top <= 0) {
    container?.scrollTo({ top: Math.max(top, 0) });
    window.scrollTo({ top: Math.max(top, 0) });
    return () => undefined;
  }
  const scrollContainer = container;
  const interactionRoot = scrollContainer.parentElement ?? scrollContainer;

  let frameId = 0;
  let stopped = false;
  const observer = new ResizeObserver(attemptRestore);

  function attemptRestore() {
    if (stopped) return;
    const maxScrollTop = Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0);
    scrollContainer.scrollTo({ top: Math.min(top, maxScrollTop) });
    if (maxScrollTop >= top - 1) stop();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frameId);
    observer.disconnect();
    interactionRoot.removeEventListener("pointerdown", stop);
    interactionRoot.removeEventListener("touchstart", stop);
    interactionRoot.removeEventListener("wheel", stop);
    interactionRoot.removeEventListener("keydown", stop);
  }

  observer.observe(scrollContainer);
  if (scrollContainer.firstElementChild) observer.observe(scrollContainer.firstElementChild);
  interactionRoot.addEventListener("pointerdown", stop, { passive: true });
  interactionRoot.addEventListener("touchstart", stop, { passive: true });
  interactionRoot.addEventListener("wheel", stop, { passive: true });
  interactionRoot.addEventListener("keydown", stop);
  frameId = requestAnimationFrame(attemptRestore);
  return stop;
}
