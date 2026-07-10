"use client";

import { Check, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { HTMLAttributes, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./ConfirmDialog";

const MOBILE_DRAG_THRESHOLD = 76;
const DESKTOP_DRAG_THRESHOLD = 224;
const COMMIT_FEEDBACK_MS = 100;
const DESKTOP_DRAG_AXIS_LOCK_PX = 8;
const MOBILE_DRAG_AXIS_LOCK_PX = 5;
const DESKTOP_VERTICAL_AXIS_LOCK_PX = 8;
const MOBILE_VERTICAL_AXIS_LOCK_PX = 8;
const DESKTOP_VERTICAL_MAX_HORIZONTAL_PX = 18;
const MOBILE_VERTICAL_MAX_HORIZONTAL_PX = 28;
const DESKTOP_DRAG_AXIS_RATIO = 1.35;
const MOBILE_DRAG_AXIS_RATIO = 1.12;

let horizontalDragLockCount = 0;

type Props = {
  watched: boolean;
  label: string;
  requireWatchConfirm?: boolean;
  disabled?: boolean;
  onChange: (watched: boolean) => Promise<void> | void;
  children: (
    dragStyle: { transform?: string },
    backdrop: ReactNode,
    handlers: HTMLAttributes<HTMLDivElement>,
    isDragging: boolean,
    dragState: { triggered: boolean; direction: "watched" | "unwatched" | null; unavailable: boolean },
  ) => ReactNode;
};

export function EpisodeWatchToggle({ watched, label, requireWatchConfirm = false, disabled, onChange, children }: Props) {
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
  const suppressButtonClickRef = useRef(false);
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
    return () => unlockHorizontalDragScroll();
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
    setCommitFeedback(next ? "watched" : "unwatched");
    try {
      await wait(COMMIT_FEEDBACK_MS);
      await onChange(next);
    } finally {
      setPending(false);
      setCommitFeedback(null);
    }
  }

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if (disabled || pending) {
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

  const backdrop = commitFeedback ? (
    <div className={cn(
      "pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-colors duration-200",
      commitFeedback === "watched" ? "bg-emerald-500 text-white" : "bg-sky-500 text-white",
    )}>
      <div className="animate-check-pop rounded-full bg-white/20 p-4 shadow-lg backdrop-blur-sm">
        {commitFeedback === "watched" ? <Check className="h-9 w-9" /> : <EyeOff className="h-9 w-9" />}
      </div>
    </div>
  ) : dragX === 0 ? null : (
    <div className={cn(
      "pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-colors",
      dragUnavailable ? "bg-muted text-muted-foreground" : dragX < 0 ? "bg-emerald-500/20" : "bg-sky-500/20",
      triggered && (dragUnavailable ? "bg-muted text-muted-foreground" : dragX < 0 ? "bg-emerald-500 text-white" : "bg-sky-500 text-white"),
    )} style={{ opacity: Math.max(0.25, progress) }}>
      <div className="flex items-center justify-center rounded-full bg-white/15 p-4 font-medium shadow-sm backdrop-blur-sm" style={{ transform: `scale(${0.8 + progress * 0.3})`, opacity: Math.max(0.35, progress) }}>
        {dragX < 0 ? <Check className="h-8 w-8" /> : <EyeOff className="h-8 w-8" />}
      </div>
    </div>
  );

  return (
    <>
      <div className="relative overflow-hidden">
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
          )}
        <button
          type="button"
          role="checkbox"
          aria-checked={watched}
          aria-label={label}
          disabled={disabled || pending}
          className={cn(
            "absolute right-3 top-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-4 sm:h-9 sm:w-9",
            watched && "border-emerald-500 bg-emerald-500 text-white shadow-emerald-500/20",
          )}
          style={{ transform: `translate(${dragX}px, -50%)` }}
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
          <Check className={cn("h-6 w-6 opacity-0 sm:h-5 sm:w-5", watched && "animate-check-pop opacity-100")} />
        </button>
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  return window.innerWidth >= 768 ? DESKTOP_DRAG_THRESHOLD : MOBILE_DRAG_THRESHOLD;
}

function getDragAxisLockThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_AXIS_LOCK_PX;
  }
  return window.innerWidth >= 768 ? DESKTOP_DRAG_AXIS_LOCK_PX : MOBILE_DRAG_AXIS_LOCK_PX;
}

function getVerticalAxisLockThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_VERTICAL_AXIS_LOCK_PX;
  }
  return window.innerWidth >= 768 ? DESKTOP_VERTICAL_AXIS_LOCK_PX : MOBILE_VERTICAL_AXIS_LOCK_PX;
}

function getVerticalMaxHorizontal() {
  if (typeof window === "undefined") {
    return MOBILE_VERTICAL_MAX_HORIZONTAL_PX;
  }
  return window.innerWidth >= 768 ? DESKTOP_VERTICAL_MAX_HORIZONTAL_PX : MOBILE_VERTICAL_MAX_HORIZONTAL_PX;
}

function getDragAxisRatio() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_AXIS_RATIO;
  }
  return window.innerWidth >= 768 ? DESKTOP_DRAG_AXIS_RATIO : MOBILE_DRAG_AXIS_RATIO;
}
