"use client";

import { AlertCircle, Check, EyeOff, LoaderCircle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { HTMLAttributes, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { matchesDesktopPlatform } from "@/components/layout/platform-layout";

import { ConfirmDialog } from "./ConfirmDialog";

const MOBILE_DRAG_THRESHOLD = 76;
const DESKTOP_DRAG_THRESHOLD = 224;
const COMMIT_FEEDBACK_MS = 700;
const DESKTOP_DRAG_AXIS_LOCK_PX = 8;
const MOBILE_DRAG_AXIS_LOCK_PX = 5;
const DESKTOP_VERTICAL_AXIS_LOCK_PX = 8;
const MOBILE_VERTICAL_AXIS_LOCK_PX = 8;
const DESKTOP_VERTICAL_MAX_HORIZONTAL_PX = 18;
const MOBILE_VERTICAL_MAX_HORIZONTAL_PX = 28;
const DESKTOP_DRAG_AXIS_RATIO = 1.35;
const MOBILE_DRAG_AXIS_RATIO = 1.12;
const EDGE_BACK_GESTURE_GUARD_PX = 24;

let horizontalDragLockCount = 0;

type Props = {
  watched: boolean;
  label: string;
  requireWatchConfirm?: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  onChange: (watched: boolean) => Promise<void> | void;
  children: (
    dragStyle: { transform?: string },
    backdrop: ReactNode,
    handlers: HTMLAttributes<HTMLDivElement>,
    isDragging: boolean,
    dragState: { triggered: boolean; direction: "watched" | "unwatched" | null; unavailable: boolean },
    watchButton: ReactNode,
  ) => ReactNode;
};

export function EpisodeWatchToggle({ watched, label, requireWatchConfirm = false, disabled, buttonClassName, onChange, children }: Props) {
  const t = useTranslations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    pointerId: number;
    axis: "pending" | "horizontal" | "vertical";
    scrollLocked: boolean;
  } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState(false);
  const [commitFeedback, setCommitFeedback] = useState<"watched" | "unwatched" | null>(null);
  const [failedTarget, setFailedTarget] = useState<boolean | null>(null);
  const suppressButtonClickRef = useRef(false);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const threshold = getDragThreshold();
  const axisLockThreshold = getDragAxisLockThreshold();
  const verticalAxisLockThreshold = getVerticalAxisLockThreshold();
  const verticalMaxHorizontal = getVerticalMaxHorizontal();
  const axisRatio = getDragAxisRatio();
  const abs = Math.min(Math.abs(dragX), threshold);
  const progress = abs / threshold;
  const triggered = abs >= threshold;
  const dragDirection = dragX === 0 ? null : dragX < 0 ? "watched" : "unwatched";
  const dragUnavailable = dragDirection === "watched" ? watched : dragDirection === "unwatched" ? !watched : false;

  useEffect(() => {
    return () => {
      unlockHorizontalDragScroll();
      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  async function apply(next: boolean) {
    if (disabled || pending || next === watched) {
      return;
    }
    if (!next) {
      setConfirmTarget(next);
      setConfirmOpen(true);
      return;
    }
    if (requireWatchConfirm) {
      setConfirmTarget(next);
      setConfirmOpen(true);
      return;
    }
    await commitChange(next);
  }

  async function commitChange(next: boolean) {
    setPending(true);
    setFailedTarget(null);
    try {
      await onChange(next);
      setCommitFeedback(next ? "watched" : "unwatched");
      feedbackTimeoutRef.current = window.setTimeout(() => {
        setCommitFeedback(null);
        feedbackTimeoutRef.current = null;
      }, COMMIT_FEEDBACK_MS);
    } catch {
      setFailedTarget(next);
    } finally {
      setPending(false);
    }
  }

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if (disabled || pending) {
      return;
    }
    if (event.clientX <= EDGE_BACK_GESTURE_GUARD_PX) {
      return;
    }
    setDragStart({ x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: "pending", scrollLocked: false });
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return false;
    }

    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (dragStart.axis === "pending") {
      if (absX < axisLockThreshold && absY < axisLockThreshold) {
        return false;
      }

      if (absY >= verticalAxisLockThreshold && absX <= verticalMaxHorizontal && absY > absX * axisRatio) {
        setDragStart({ ...dragStart, axis: "vertical" });
        setDragX(0);
        unlockHorizontalDragScroll();
        return false;
      }

      if (absX < axisLockThreshold || absX <= absY * axisRatio) {
        return false;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      if (!dragStart.scrollLocked) {
        lockHorizontalDragScroll();
      }
      setDragStart({ ...dragStart, axis: "horizontal", scrollLocked: true });
    }

    if (dragStart.axis === "vertical") {
      return false;
    }

    event.preventDefault();
    setDragX(Math.max(-threshold * 1.15, Math.min(threshold * 1.15, deltaX)));
    return true;
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return false;
    }
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const inferredHorizontal = absX >= axisLockThreshold && absX > absY * axisRatio;
    const finalX = dragStart.axis === "horizontal" || inferredHorizontal ? deltaX : dragX;
    const axis = dragStart.axis === "horizontal" || inferredHorizontal ? "horizontal" : dragStart.axis;
    setDragStart(null);
    setDragX(0);
    unlockHorizontalDragScroll();
    if (axis !== "horizontal") {
      return false;
    }
    if (finalX <= -threshold) {
      void apply(true);
    } else if (finalX >= threshold) {
      void apply(false);
    }
    return true;
  }

  function cancelDrag() {
    setDragStart(null);
    setDragX(0);
    unlockHorizontalDragScroll();
  }

  const dragHandlers: HTMLAttributes<HTMLDivElement> = {
    onPointerDown: beginDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  };

  const watchButton = (
    <button
      type="button"
      role="checkbox"
      aria-checked={watched}
      aria-label={label}
      aria-busy={pending}
      disabled={disabled || pending}
      className={cn(
        "episode-watch-button interactive-surface absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-[var(--surface-card)] shadow-[var(--shadow-low)] hover:bg-[var(--surface-hover)] hover:shadow-[var(--shadow-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
        watched && "border-[var(--watched)] bg-[var(--watched)] text-white hover:bg-[var(--watched)]",
        buttonClassName,
      )}
      onPointerDown={(event) => {
        suppressButtonClickRef.current = false;
        beginDrag(event);
      }}
      onPointerMove={(event) => {
        if (moveDrag(event)) {
          suppressButtonClickRef.current = true;
        }
      }}
      onPointerUp={(event) => {
        if (endDrag(event)) {
          suppressButtonClickRef.current = true;
        }
      }}
      onPointerCancel={cancelDrag}
      onClick={(event) => {
        if (suppressButtonClickRef.current) {
          suppressButtonClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        void apply(!watched);
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          void apply(!watched);
        }
      }}
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Check className={cn("h-6 w-6 opacity-0 sm:h-5 sm:w-5", watched && "animate-check-pop opacity-100")} />}
    </button>
  );

  const backdrop = commitFeedback ? (
    <div className={cn(
      "pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-colors duration-200",
      commitFeedback === "watched" ? "bg-emerald-500/90 text-white" : "bg-sky-500/90 text-white",
    )}>
      <div className="animate-check-pop rounded-full bg-white/20 p-4 shadow-lg backdrop-blur-sm">
        {commitFeedback === "watched" ? <Check className="h-9 w-9" /> : <EyeOff className="h-9 w-9" />}
      </div>
    </div>
  ) : dragX === 0 ? null : (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]">
      <div
        className={cn(
          "absolute inset-y-0 right-[-1px] flex w-[calc(50%+2px)] items-center justify-end pr-8 transition-colors",
          dragUnavailable ? "bg-muted text-muted-foreground" : triggered ? "bg-[var(--watched)] text-white" : "bg-[var(--accent-soft)] text-[var(--accent-solid)]",
          dragX >= 0 && "opacity-0",
        )}
        style={{ opacity: dragX < 0 ? Math.max(0.22, progress) : 0 }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/16 font-medium shadow-sm backdrop-blur-sm" style={{ transform: `scale(${0.86 + progress * 0.16})` }}>
          <Check className="h-8 w-8" />
        </div>
      </div>
      <div
        className={cn(
          "absolute inset-y-0 left-[-1px] flex w-[calc(50%+2px)] items-center justify-start pl-8 transition-colors",
          dragUnavailable ? "bg-muted text-muted-foreground" : triggered ? "bg-amber-500 text-white" : "bg-[var(--accent-soft)] text-[var(--accent-solid)]",
          dragX <= 0 && "opacity-0",
        )}
        style={{ opacity: dragX > 0 ? Math.max(0.22, progress) : 0 }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/16 font-medium shadow-sm backdrop-blur-sm" style={{ transform: `scale(${0.86 + progress * 0.16})` }}>
          <EyeOff className="h-8 w-8" />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="relative">
          {children(
            { transform: dragX ? `translateX(${dragX}px) scale(0.992)` : undefined },
            backdrop,
            dragHandlers,
            dragStart?.axis === "horizontal",
            {
              triggered: triggered || commitFeedback !== null,
              direction: commitFeedback ?? dragDirection,
              unavailable: commitFeedback === null && dragUnavailable,
            },
            watchButton,
          )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {failedTarget !== null ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            <span className="flex min-w-0 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              {t("tracking.updateFailed")}
            </span>
            <button
              type="button"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              disabled={pending || disabled}
              onClick={() => void commitChange(failedTarget)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("tracking.retryUpdate")}
            </button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTarget ? t("library.confirmWatchTitle") : t("library.confirmUnwatchTitle")}
        description={confirmTarget ? t("library.confirmWatchDescription") : t("library.confirmUnwatchDescription")}
        confirmLabel={confirmTarget ? t("library.markWatched") : t("library.markUnwatched")}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void commitChange(confirmTarget);
        }}
      />
    </>
  );
}

function lockHorizontalDragScroll() {
  if (horizontalDragLockCount === 0) {
    window.addEventListener("touchmove", preventTouchScroll, { passive: false });
  }
  horizontalDragLockCount += 1;
  document.documentElement.classList.add("episode-horizontal-drag-lock");
  document.body.classList.add("episode-horizontal-drag-lock");
}

function unlockHorizontalDragScroll() {
  horizontalDragLockCount = Math.max(horizontalDragLockCount - 1, 0);
  if (horizontalDragLockCount === 0) {
    window.removeEventListener("touchmove", preventTouchScroll);
  }
  document.documentElement.classList.remove("episode-horizontal-drag-lock");
  document.body.classList.remove("episode-horizontal-drag-lock");
}

function preventTouchScroll(event: TouchEvent) {
  event.preventDefault();
}

function getDragThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_THRESHOLD;
  }
  return matchesDesktopPlatform() ? DESKTOP_DRAG_THRESHOLD : MOBILE_DRAG_THRESHOLD;
}

function getDragAxisLockThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_AXIS_LOCK_PX;
  }
  return matchesDesktopPlatform() ? DESKTOP_DRAG_AXIS_LOCK_PX : MOBILE_DRAG_AXIS_LOCK_PX;
}

function getVerticalAxisLockThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_VERTICAL_AXIS_LOCK_PX;
  }
  return matchesDesktopPlatform() ? DESKTOP_VERTICAL_AXIS_LOCK_PX : MOBILE_VERTICAL_AXIS_LOCK_PX;
}

function getVerticalMaxHorizontal() {
  if (typeof window === "undefined") {
    return MOBILE_VERTICAL_MAX_HORIZONTAL_PX;
  }
  return matchesDesktopPlatform() ? DESKTOP_VERTICAL_MAX_HORIZONTAL_PX : MOBILE_VERTICAL_MAX_HORIZONTAL_PX;
}

function getDragAxisRatio() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_AXIS_RATIO;
  }
  return matchesDesktopPlatform() ? DESKTOP_DRAG_AXIS_RATIO : MOBILE_DRAG_AXIS_RATIO;
}
