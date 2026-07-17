"use client";

import { useSyncExternalStore } from "react";

// Keep this in sync with the shell media queries in globals.css.
// Width establishes available space; any-* supports hybrid devices without using
// the primary pointer or window height as a proxy for the platform.
export const DESKTOP_PLATFORM_QUERY = "(min-width: 768px) and (any-hover: hover) and (any-pointer: fine)";

export function useDesktopPlatform() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function matchesDesktopPlatform() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_PLATFORM_QUERY).matches;
}

function subscribe(onStoreChange: () => void) {
  const query = window.matchMedia(DESKTOP_PLATFORM_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return matchesDesktopPlatform();
}

function getServerSnapshot() {
  return false;
}
