"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode, TouchEvent as ReactTouchEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { getMobileScrollContainer } from "./mobile-scroll-container";
import { matchesDesktopPlatform } from "./platform-layout";

const REFRESH_THRESHOLD = 72;
const MAX_PULL_DISTANCE = 112;
const REFRESH_HOLD_DISTANCE = 56;

type RefreshState = "idle" | "pulling" | "armed" | "refreshing" | "complete" | "error";

export function MobilePullToRefresh({
  children,
  onRefresh,
  disabled = false,
}: {
  children: ReactNode;
  onRefresh: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{ startX: number; startY: number; active: boolean; vertical: boolean } | null>(null);
  const resetTimeoutRef = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const [distance, setDistance] = useState(0);
  const [state, setState] = useState<RefreshState>("idle");
  const busy = state === "refreshing";

  useEffect(() => () => {
    if (resetTimeoutRef.current !== null) window.clearTimeout(resetTimeoutRef.current);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function preventNativeOverscroll(event: TouchEvent) {
      const gesture = gestureRef.current;
      if (!gesture?.active || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      if (deltaY > 4 && Math.abs(deltaY) > Math.abs(deltaX)) event.preventDefault();
    }

    root.addEventListener("touchmove", preventNativeOverscroll, { passive: false });
    return () => root.removeEventListener("touchmove", preventNativeOverscroll);
  }, []);

  function clearResetTimeout() {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      cancelGesture();
      return;
    }
    if (disabled || state !== "idle" || matchesDesktopPlatform() || !isEligibleGestureTarget(event.target)) return;
    const scrollContainer = getMobileScrollContainer();
    if ((scrollContainer?.scrollTop ?? window.scrollY) > 0) return;

    clearResetTimeout();
    const touch = event.touches[0];
    gestureRef.current = { startX: touch.clientX, startY: touch.clientY, active: true, vertical: false };
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (event.touches.length !== 1) {
      cancelGesture();
      return;
    }
    if (!gesture?.active) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (!gesture.vertical) {
      if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY <= 8) {
        if (Math.abs(deltaX) > 8 || deltaY < -4) gesture.active = false;
        return;
      }
      gesture.vertical = true;
    }
    if (deltaY <= 0) {
      distanceRef.current = 0;
      setDistance(0);
      setState("idle");
      return;
    }

    const nextDistance = Math.min(MAX_PULL_DISTANCE, Math.sqrt(deltaY) * 9);
    distanceRef.current = nextDistance;
    setDistance(nextDistance);
    setState(nextDistance >= REFRESH_THRESHOLD ? "armed" : "pulling");
  }

  function finishGesture() {
    if (!gestureRef.current) return;
    const shouldRefresh = distanceRef.current >= REFRESH_THRESHOLD;
    gestureRef.current = null;
    if (shouldRefresh && !disabled && !busy) {
      void refresh();
      return;
    }
    distanceRef.current = 0;
    setDistance(0);
    setState("idle");
  }

  function cancelGesture() {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    distanceRef.current = 0;
    setDistance(0);
    setState("idle");
  }

  async function refresh() {
    if (disabled || busy) {
      cancelGesture();
      return;
    }
    clearResetTimeout();
    distanceRef.current = REFRESH_HOLD_DISTANCE;
    setDistance(REFRESH_HOLD_DISTANCE);
    setState("refreshing");
    try {
      await onRefresh();
      setState("complete");
    } catch {
      setState("error");
    } finally {
      resetTimeoutRef.current = window.setTimeout(() => {
        distanceRef.current = 0;
        setDistance(0);
        setState("idle");
        resetTimeoutRef.current = null;
      }, 700);
    }
  }

  const statusLabel = state === "armed"
    ? t("app.pullToRefresh.release")
    : state === "refreshing"
      ? t("app.pullToRefresh.refreshing")
      : state === "complete"
        ? t("app.pullToRefresh.complete")
        : state === "error"
          ? t("app.pullToRefresh.failed")
          : t("app.pullToRefresh.pull");
  const pullOpacity = Math.min(Math.max((distance - 12) / (REFRESH_THRESHOLD - 12), 0), 1);
  const style = {
    "--pull-distance": `${distance}px`,
    "--pull-opacity": pullOpacity,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="mobile-pull-refresh"
      data-state={state}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishGesture}
      onTouchCancel={cancelGesture}
    >
      {state !== "idle" ? (
        <div className="mobile-pull-refresh-indicator" role="status" aria-live="polite" aria-atomic="true">
          <RefreshCw className="mobile-pull-refresh-indicator-icon" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      ) : null}
      <div className="mobile-pull-refresh-content">{children}</div>
    </div>
  );

  function isEligibleGestureTarget(target: EventTarget | null) {
    const root = rootRef.current;
    if (!(target instanceof Element) || !root?.contains(target)) return false;
    if (target.closest(".episode-ticket, [data-pull-refresh-ignore]")) return false;
    const nestedScrollArea = target.closest(".scroll-area-viewport");
    return !nestedScrollArea || nestedScrollArea === getMobileScrollContainer();
  }
}
