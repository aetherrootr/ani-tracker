"use client";

import { Check, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { HTMLAttributes, ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./ConfirmDialog";

const MOBILE_DRAG_THRESHOLD = 84;
const DESKTOP_DRAG_THRESHOLD = 224;

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
    dragState: { triggered: boolean; direction: "watched" | "unwatched" | null },
  ) => ReactNode;
};

export function EpisodeWatchToggle({ watched, label, requireWatchConfirm = false, disabled, onChange, children }: Props) {
  const t = useTranslations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragStart, setDragStart] = useState<{ x: number; pointerId: number } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState(false);
  const threshold = getDragThreshold();
  const abs = Math.min(Math.abs(dragX), threshold);
  const progress = abs / threshold;
  const triggered = abs >= threshold;

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
    setPending(true);
    try {
      await onChange(next);
    } finally {
      setPending(false);
    }
  }

  const dragHandlers: HTMLAttributes<HTMLDivElement> = {
    onPointerDown(event) {
      if (disabled || pending) {
        return;
      }
      setDragStart({ x: event.clientX, pointerId: event.pointerId });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
      if (!dragStart || dragStart.pointerId !== event.pointerId) {
        return;
      }
      setDragX(Math.max(-threshold * 1.15, Math.min(threshold * 1.15, event.clientX - dragStart.x)));
    },
    onPointerUp(event) {
      if (!dragStart || dragStart.pointerId !== event.pointerId) {
        return;
      }
      const finalX = dragX;
      setDragStart(null);
      setDragX(0);
      if (finalX <= -threshold) {
        void apply(true);
      } else if (finalX >= threshold) {
        void apply(false);
      }
    },
    onPointerCancel() {
      setDragStart(null);
      setDragX(0);
    },
  };

  const backdrop = dragX === 0 ? null : (
    <div className={cn("absolute inset-0 flex items-center px-5 transition-colors", dragX < 0 ? "justify-end bg-emerald-500/20" : "justify-start bg-sky-500/20", triggered && (dragX < 0 ? "bg-emerald-500/40" : "bg-sky-500/40"))} style={{ opacity: Math.max(0.25, progress) }}>
      <div className="flex items-center gap-2 font-medium" style={{ transform: `scale(${0.8 + progress * 0.25})`, opacity: progress }}>
        {dragX < 0 ? <Check className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        <span>{dragX < 0 ? t("library.markWatched") : t("library.markUnwatched")}</span>
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
          dragStart !== null,
          { triggered, direction: dragX === 0 ? null : dragX < 0 ? "watched" : "unwatched" },
        )}
        <button
          type="button"
          role="checkbox"
          aria-checked={watched}
          aria-label={label}
          disabled={disabled || pending}
          className={cn(
            "absolute right-4 top-1/2 z-20 flex h-9 w-9 items-center justify-center rounded-full border-2 bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            watched && "border-emerald-500 bg-emerald-500 text-white shadow-emerald-500/20",
          )}
          style={{ transform: `translate(${dragX}px, -50%)` }}
          onClick={() => void apply(!watched)}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              void apply(!watched);
            }
          }}
        >
          <Check className={cn("h-5 w-5 opacity-0", watched && "animate-check-pop opacity-100")} />
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
          setPending(true);
          Promise.resolve(onChange(confirmTarget)).finally(() => setPending(false));
        }}
      />
    </>
  );
}

function getDragThreshold() {
  if (typeof window === "undefined") {
    return MOBILE_DRAG_THRESHOLD;
  }
  return window.innerWidth >= 768 ? DESKTOP_DRAG_THRESHOLD : MOBILE_DRAG_THRESHOLD;
}
