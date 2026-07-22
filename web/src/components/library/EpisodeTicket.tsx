"use client";

import { AlertCircle, Check, Clock3, LoaderCircle, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./ConfirmDialog";

const EDGE_GUARD = 24;
const MOBILE_HYSTERESIS = 12;
const MOBILE_COMMIT_THRESHOLD = 76;
const MOBILE_HORIZONTAL_LOCK = 5;
const MOBILE_VERTICAL_LOCK = 8;
const MOBILE_VERTICAL_MAX_HORIZONTAL = 28;
const MOBILE_AXIS_RATIO = 1.12;
const DESKTOP_HYSTERESIS = 24;
const DESKTOP_HORIZONTAL_LOCK = 6;
const DESKTOP_VERTICAL_LOCK = 12;
const DESKTOP_AXIS_RATIO = 1.2;

type DragSession = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  axis: "pending" | "horizontal" | "vertical";
  threshold: number;
  rtl: boolean;
  armed: boolean | null;
  scrollLocked: boolean;
  interactiveStart: boolean;
};

type Props = {
  watched: boolean;
  label: string;
  accessibleLabel: string;
  children: ReactNode;
  id?: string;
  disabled?: boolean;
  requireWatchConfirm?: boolean;
  density?: "standard" | "compact" | "recent";
  className?: string;
  onChange: (watched: boolean) => Promise<void> | void;
};

export function EpisodeTicket({
  watched,
  label,
  accessibleLabel,
  children,
  id,
  disabled = false,
  requireWatchConfirm = false,
  density = "standard",
  className,
  onChange,
}: Props) {
  const t = useTranslations();
  const rootRef = useRef<HTMLElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const scrollLockOwnerRef = useRef(Symbol("episode-ticket-scroll-lock"));
  const suppressInteractiveClickRef = useRef(false);
  const clickSuppressTimerRef = useRef<number | null>(null);
  const nativeTouchHandlersRef = useRef<{
    start: (event: TouchEvent) => void;
    move: (event: TouchEvent) => void;
    end: () => void;
    cancel: () => void;
  } | null>(null);
  const pointerHandlersRef = useRef<{
    interrupt: (event: PointerEvent) => void;
    move: (event: PointerEvent) => void;
    complete: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    leave: (event: PointerEvent) => void;
  } | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const outgoingContentRef = useRef<ReactNode>(null);
  const outgoingWatchedRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [armedTarget, setArmedTarget] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"rest" | "tracking" | "returning" | "committing" | "restoring">("rest");
  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  const [failedTarget, setFailedTarget] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(false);
  const [commitMotionMode, setCommitMotionMode] = useState<"full" | "reduced" | null>(null);
  const [slowPending, setSlowPending] = useState(false);
  const effectiveWatched = pendingTarget ?? watched;
  const pending = pendingTarget !== null;

  useEffect(() => {
    const scrollLockOwner = scrollLockOwnerRef.current;

    function releaseInterruptedDrag() {
      blockedPointerStarts.clear();
      blockNextTouchStart = false;
      const session = dragRef.current;
      unlockMobileScroll(scrollLockOwner);
      if (!session) return;
      dragRef.current = null;
      suppressInteractiveClickRef.current = false;
      setDragX(0);
      setArmedTarget(null);
      setPhase("rest");
    }

    function cancelWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && dragRef.current) {
        const session = dragRef.current;
        dragRef.current = null;
        if (session.scrollLocked) unlockMobileScroll(scrollLockOwner);
        suppressInteractiveClickRef.current = false;
        setPhase("returning");
        setDragX(0);
        setArmedTarget(null);
        resetTimerRef.current = window.setTimeout(() => setPhase("rest"), 210);
      }
    }
    const interruptPointer = (event: PointerEvent) => pointerHandlersRef.current?.interrupt(event);
    const movePointer = (event: PointerEvent) => pointerHandlersRef.current?.move(event);
    const completePointer = (event: PointerEvent) => pointerHandlersRef.current?.complete(event);
    const cancelPointer = (event: PointerEvent) => pointerHandlersRef.current?.cancel(event);
    const leavePointer = (event: PointerEvent) => pointerHandlersRef.current?.leave(event);
    window.addEventListener("keydown", cancelWithEscape);
    window.addEventListener("blur", releaseInterruptedDrag);
    window.addEventListener("pagehide", releaseInterruptedDrag);
    window.addEventListener("pointerdown", interruptPointer, true);
    window.addEventListener("pointermove", movePointer, { passive: false });
    window.addEventListener("pointerup", completePointer);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("pointerout", leavePointer);
    document.addEventListener("visibilitychange", releaseInterruptedDrag);
    return () => {
      window.removeEventListener("keydown", cancelWithEscape);
      window.removeEventListener("blur", releaseInterruptedDrag);
      window.removeEventListener("pagehide", releaseInterruptedDrag);
      window.removeEventListener("pointerdown", interruptPointer, true);
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", completePointer);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("pointerout", leavePointer);
      document.removeEventListener("visibilitychange", releaseInterruptedDrag);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
      suppressInteractiveClickRef.current = false;
      dragRef.current = null;
      unlockMobileScroll(scrollLockOwner);
    };
  }, []);

  useEffect(() => {
    const front = frontRef.current;
    if (!front) return;
    const start = (event: TouchEvent) => nativeTouchHandlersRef.current?.start(event);
    const move = (event: TouchEvent) => nativeTouchHandlersRef.current?.move(event);
    const end = () => nativeTouchHandlersRef.current?.end();
    const cancel = () => nativeTouchHandlersRef.current?.cancel();
    const cancelMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1 && dragRef.current?.pointerType === "touch") nativeTouchHandlersRef.current?.cancel();
    };
    front.addEventListener("touchstart", start, { passive: true });
    front.addEventListener("touchmove", move, { passive: false });
    front.addEventListener("touchend", end, { passive: true });
    front.addEventListener("touchcancel", cancel, { passive: true });
    document.addEventListener("touchstart", cancelMultiTouch, { passive: true, capture: true });
    return () => {
      front.removeEventListener("touchstart", start);
      front.removeEventListener("touchmove", move);
      front.removeEventListener("touchend", end);
      front.removeEventListener("touchcancel", cancel);
      document.removeEventListener("touchstart", cancelMultiTouch, true);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlowPending(true), 2000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    if (blockedPointerStarts.delete(event.pointerId)) return;
    if (disabled || pending || event.button !== 0) return;
    startDrag(event.clientX, event.clientY, event.pointerId, event.pointerType, event.target as HTMLElement, event.pointerType === "pen");
  }

  function startDrag(clientX: number, clientY: number, pointerId: number, pointerType: string, target: HTMLElement, allowInteractive: boolean) {
    if (dragRef.current) cancelDrag();
    if (disabled || pending) return false;
    const interactiveStart = Boolean(target.closest("a,button,input,select,textarea,[data-ticket-interactive]"));
    const dragSurfaceStart = Boolean(target.closest("[data-ticket-drag-surface]"));
    if (interactiveStart && !allowInteractive && !dragSurfaceStart) return false;
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    if (!root || !rect) return false;
    const rtl = getComputedStyle(root).direction === "rtl";
    const touchLike = pointerType !== "mouse";
    const distanceFromLeading = rtl ? window.innerWidth - clientX : clientX;
    if (touchLike && distanceFromLeading <= EDGE_GUARD) return false;
    const desktop = pointerType === "mouse";
    finishCommit();
    if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
    clickSuppressTimerRef.current = null;
    suppressInteractiveClickRef.current = false;
    dragRef.current = {
      pointerId,
      pointerType,
      startX: clientX,
      startY: clientY,
      axis: "pending",
      threshold: desktop ? clamp(96, rect.width * 0.18, 160) : MOBILE_COMMIT_THRESHOLD,
      rtl,
      armed: null,
      scrollLocked: false,
      interactiveStart,
    };
    return true;
  }

  function updateDrag(clientX: number, clientY: number) {
    const session = dragRef.current;
    if (!session) return false;
    const deltaX = clientX - session.startX;
    const deltaY = clientY - session.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const desktop = session.pointerType === "mouse";
    const lockDistance = desktop ? DESKTOP_HORIZONTAL_LOCK : MOBILE_HORIZONTAL_LOCK;
    const axisRatio = desktop ? DESKTOP_AXIS_RATIO : MOBILE_AXIS_RATIO;

    if (session.axis === "pending") {
      if (absX < lockDistance && absY < lockDistance) return;
      const verticalIntent = desktop
        ? absY >= DESKTOP_VERTICAL_LOCK && absY > absX * axisRatio
        : absY >= MOBILE_VERTICAL_LOCK && absX <= MOBILE_VERTICAL_MAX_HORIZONTAL && absY > absX * axisRatio;
      if (verticalIntent) {
        session.axis = "vertical";
        return;
      }
      if (absX < lockDistance || absX < absY * axisRatio) return;
      session.axis = "horizontal";
      if (session.interactiveStart) suppressInteractiveClickRef.current = true;
      if (!desktop) {
        lockMobileScroll(scrollLockOwnerRef.current);
        session.scrollLocked = true;
      }
      setPhase("tracking");
    }
    if (session.axis !== "horizontal") return false;
    const semanticX = deltaX * (session.rtl ? -1 : 1);
    const target = semanticX < 0;
    const unavailable = target === watched;
    const limit = unavailable ? (session.pointerType === "mouse" ? 32 : 24) : session.threshold * 1.12;
    const visualX = Math.sign(deltaX) * Math.min(Math.abs(deltaX), limit);
    const distance = Math.abs(semanticX);
    const hysteresis = desktop ? DESKTOP_HYSTERESIS : MOBILE_HYSTERESIS;

    if (!unavailable) {
      if (session.armed === null && distance >= session.threshold) session.armed = target;
      if (session.armed !== null && (session.armed !== target || distance < session.threshold - hysteresis)) session.armed = null;
    } else {
      session.armed = null;
    }
    setArmedTarget(session.armed);
    setDragX(visualX);
    return true;
  }

  function completeDrag() {
    const session = dragRef.current;
    if (!session) return;
    dragRef.current = null;
    if (session.scrollLocked) unlockMobileScroll(scrollLockOwnerRef.current);
    if (session.axis === "horizontal" && session.interactiveStart) {
      if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
      clickSuppressTimerRef.current = window.setTimeout(() => {
        suppressInteractiveClickRef.current = false;
        clickSuppressTimerRef.current = null;
      }, 700);
    }
    if (session.axis !== "horizontal") {
      resetDrag();
      return;
    }
    if (session.armed !== null) {
      commitGesture(session.armed);
      return;
    }
    resetDrag();
  }

  function cancelDrag() {
    const session = dragRef.current;
    dragRef.current = null;
    if (session?.scrollLocked) unlockMobileScroll(scrollLockOwnerRef.current);
    suppressInteractiveClickRef.current = false;
    if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
    clickSuppressTimerRef.current = null;
    resetDrag();
  }

  function resetDrag() {
    setPhase("returning");
    setDragX(0);
    setArmedTarget(null);
    scheduleRest(210);
  }

  function commitGesture(target: boolean) {
    setArmedTarget(null);
    if (!target || requireWatchConfirm) {
      resetDrag();
      void apply(target);
      return;
    }
    if (target) {
      startWatchedCommit();
    } else {
      setPhase("restoring");
      scheduleRest(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 130 : 300);
    }
    void requestChange(target);
  }

  function scheduleRest(delay: number) {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      finishCommit();
    }, delay);
  }

  function finishCommit() {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setPhase("rest");
    setDragX(0);
    setCommitMotionMode(null);
    outgoingContentRef.current = null;
  }

  function startWatchedCommit() {
    const root = rootRef.current;
    if (!root) return;

    outgoingContentRef.current = children;
    outgoingWatchedRef.current = watched;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setCommitMotionMode(reducedMotion ? "reduced" : "full");
    setPhase("committing");
    // The full-motion timeout is a fallback for browsers that fail to emit animationend.
    scheduleRest(reducedMotion ? 150 : 500);
  }

  async function apply(target: boolean) {
    if (disabled || pending || target === watched) return;
    if (!target || requireWatchConfirm) {
      setConfirmTarget(target);
      setConfirmOpen(true);
      return;
    }
    await requestChange(target);
  }

  async function requestChange(target: boolean) {
    setSlowPending(false);
    setPendingTarget(target);
    setFailedTarget(null);
    try {
      await onChange(target);
      setAnnouncement(target ? t("library.markedWatched") : t("library.markedUnwatched"));
    } catch {
      setFailedTarget(target);
      setAnnouncement(t("tracking.updateFailed"));
    } finally {
      setSlowPending(false);
      setPendingTarget(null);
    }
  }

  const semanticDragX = dragX * (rootRef.current && getComputedStyle(rootRef.current).direction === "rtl" ? -1 : 1);
  const dragTarget = semanticDragX === 0 ? null : semanticDragX < 0;
  const unavailable = dragTarget !== null && dragTarget === watched;
  const railTarget = armedTarget ?? dragTarget;
  const progress = dragRef.current ? Math.min(Math.abs(dragX) / dragRef.current.threshold, 1) : 0;
  const railLabel = unavailable
    ? t("library.actionUnavailable")
    : railTarget === true
      ? armedTarget === true ? t("library.releaseToMarkWatched") : t("library.markWatched")
      : railTarget === false
        ? armedTarget === false ? t("library.releaseToMarkUnwatched") : t("library.markUnwatched")
        : "";

  nativeTouchHandlersRef.current = {
    start(event) {
      if (blockNextTouchStart) {
        blockNextTouchStart = false;
        return;
      }
      if (event.touches.length !== 1) {
        if (dragRef.current) cancelDrag();
        return;
      }
      const touch = event.touches[0];
      startDrag(touch.clientX, touch.clientY, -1, "touch", event.target as HTMLElement, true);
    },
    move(event) {
      if (event.touches.length !== 1 || dragRef.current?.pointerType !== "touch") {
        if (dragRef.current?.pointerType === "touch") cancelDrag();
        return;
      }
      const touch = event.touches[0];
      if (updateDrag(touch.clientX, touch.clientY)) event.preventDefault();
    },
    end() {
      if (dragRef.current?.pointerType === "touch") completeDrag();
    },
    cancel() {
      if (dragRef.current?.pointerType === "touch") cancelDrag();
    },
  };
  pointerHandlersRef.current = {
    interrupt(event) {
      if (dragRef.current) {
        if (dragRef.current.pointerId !== event.pointerId) {
          if (event.pointerType === "touch") {
            blockNextTouchStart = true;
            window.setTimeout(() => {
              blockNextTouchStart = false;
            }, 0);
          } else {
            blockedPointerStarts.add(event.pointerId);
            queueMicrotask(() => blockedPointerStarts.delete(event.pointerId));
          }
        }
        cancelDrag();
        return;
      }
      suppressInteractiveClickRef.current = false;
      if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
      clickSuppressTimerRef.current = null;
    },
    move(event) {
      const session = dragRef.current;
      if (session?.pointerType === "touch" || session?.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        if (session.axis === "horizontal" && session.armed !== null) completeDrag();
        else cancelDrag();
        return;
      }
      if (updateDrag(event.clientX, event.clientY)) event.preventDefault();
    },
    complete(event) {
      blockedPointerStarts.delete(event.pointerId);
      const session = dragRef.current;
      if (session?.pointerType !== "touch" && session?.pointerId === event.pointerId) completeDrag();
    },
    cancel(event) {
      blockedPointerStarts.delete(event.pointerId);
      const session = dragRef.current;
      if (session?.pointerType !== "touch" && session?.pointerId === event.pointerId) cancelDrag();
    },
    leave(event) {
      if (event.relatedTarget === null) blockedPointerStarts.delete(event.pointerId);
      const session = dragRef.current;
      if (event.relatedTarget === null && session?.pointerType !== "touch" && session?.pointerId === event.pointerId) cancelDrag();
    },
  };

  return (
    <div className={cn("episode-ticket-group", className)}>
      <article
        ref={rootRef}
        id={id}
        aria-label={accessibleLabel}
        data-density={density}
        data-watched={effectiveWatched || undefined}
        data-phase={phase}
        data-motion-mode={commitMotionMode ?? undefined}
        data-outgoing-watched={phase === "committing" && outgoingWatchedRef.current ? true : undefined}
        data-armed={armedTarget === null ? undefined : armedTarget ? "watched" : "unwatched"}
        className="episode-ticket"
      >
        <div
          className="episode-ticket-rail"
          data-target={railTarget === null ? undefined : railTarget ? "watched" : "unwatched"}
          data-unavailable={unavailable || undefined}
          style={{ "--ticket-progress": progress } as React.CSSProperties}
          aria-hidden="true"
        >
          <span className="episode-ticket-rail-action episode-ticket-rail-action-watched">
            {unavailable ? <Clock3 /> : <Check />}
            <span>{railLabel}</span>
          </span>
          <span className="episode-ticket-rail-action episode-ticket-rail-action-unwatched">
            {unavailable ? <Clock3 /> : <Undo2 />}
            <span>{railLabel}</span>
          </span>
        </div>
        {railLabel ? <span className="sr-only">{railLabel}</span> : null}

        <div className="episode-ticket-underlayer" inert aria-hidden="true">
          <div className="episode-ticket-body">{children}</div>
          <div className="episode-ticket-stub">
            <span className="episode-ticket-check-label episode-ticket-check-label-visual">
              <span className="episode-ticket-checkbox episode-ticket-checkbox-visual" />
              <span className="episode-ticket-check-glyph"><Check /></span>
            </span>
          </div>
        </div>
        <div
          ref={frontRef}
          className="episode-ticket-front"
          style={{
            "--ticket-commit-start-x": `${dragX}px`,
            transform: dragX ? `translate3d(${dragX}px, 0, 0)${phase === "tracking" ? " scale(0.994)" : ""}` : undefined,
          } as React.CSSProperties}
          onPointerDown={beginDrag}
          onClickCapture={(event) => {
            if (!suppressInteractiveClickRef.current) return;
            suppressInteractiveClickRef.current = false;
            if (clickSuppressTimerRef.current !== null) window.clearTimeout(clickSuppressTimerRef.current);
            clickSuppressTimerRef.current = null;
            event.preventDefault();
            event.stopPropagation();
          }}
          onAnimationEnd={(event) => {
            if (event.animationName.startsWith("episode-ticket-commit") || event.animationName === "episode-ticket-restore") finishCommit();
          }}
        >
          <div className="episode-ticket-body">
            {phase === "committing" ? outgoingContentRef.current ?? children : children}
          </div>
          {slowPending ? <span className="episode-ticket-saving" role="status">{t("tracking.updating")}</span> : null}
          <div className="episode-ticket-stub">
            <label className="episode-ticket-check-label">
              <input
                ref={inputRef}
                type="checkbox"
                className="episode-ticket-checkbox"
                checked={effectiveWatched}
                disabled={disabled || pending}
                aria-label={label}
                aria-busy={pending}
                onChange={(event) => void apply(event.currentTarget.checked)}
              />
              <span className="episode-ticket-check-glyph" aria-hidden="true">
                {pending ? <LoaderCircle className="episode-ticket-spinner" /> : <Check />}
              </span>
            </label>
          </div>
        </div>
      </article>

      <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
      {failedTarget !== null ? (
        <div className="episode-ticket-error" role="alert">
          <span><AlertCircle aria-hidden="true" />{t("tracking.updateFailed")}</span>
          <button type="button" disabled={pending || disabled} onClick={() => void requestChange(failedTarget)}>
            <RotateCcw aria-hidden="true" />{t("tracking.retryUpdate")}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t(confirmTarget ? "library.confirmWatchTitle" : "library.confirmUnwatchTitle")}
        description={t(confirmTarget ? "library.confirmWatchDescription" : "library.confirmUnwatchDescription")}
        confirmLabel={t(confirmTarget ? "library.markWatched" : "library.markUnwatched")}
        onCancel={() => {
          setConfirmOpen(false);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void requestChange(confirmTarget);
        }}
      />
    </div>
  );
}

function clamp(min: number, value: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const mobileScrollLockOwners = new Set<symbol>();
const blockedPointerStarts = new Set<number>();
let blockNextTouchStart = false;

function lockMobileScroll(owner: symbol) {
  if (mobileScrollLockOwners.has(owner)) return;
  mobileScrollLockOwners.add(owner);
  if (mobileScrollLockOwners.size > 1) return;
  document.documentElement.classList.add("episode-ticket-drag-lock");
  document.body.classList.add("episode-ticket-drag-lock");
  document.addEventListener("touchmove", preventLockedTouchMove, { passive: false, capture: true });
}

function unlockMobileScroll(owner: symbol) {
  if (!mobileScrollLockOwners.delete(owner) || mobileScrollLockOwners.size > 0) return;
  document.documentElement.classList.remove("episode-ticket-drag-lock");
  document.body.classList.remove("episode-ticket-drag-lock");
  document.removeEventListener("touchmove", preventLockedTouchMove, true);
}

function preventLockedTouchMove(event: TouchEvent) {
  event.preventDefault();
}
