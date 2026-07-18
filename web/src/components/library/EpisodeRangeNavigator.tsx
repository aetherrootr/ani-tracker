"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDesktopPlatform } from "@/components/layout/platform-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalSurface } from "@/components/ui/modal-surface";
import type { EpisodeListResponse } from "@/features/library/types";

import { useAnchoredEpisodePopover } from "./use-anchored-episode-popover";

type EpisodeRange = EpisodeListResponse["ranges"][number];

export function EpisodeRangeNavigator({
  page,
  ranges,
  total,
  disabled,
  placement,
  onPageChange,
  onEpisodeJump,
}: {
  page: number;
  ranges: EpisodeRange[];
  total: number;
  disabled: boolean;
  placement: "header" | "footer";
  onPageChange: (page: number) => void;
  onEpisodeJump: (episodeNumber: number) => void;
}) {
  const t = useTranslations();
  const desktop = useDesktopPlatform();
  const titleId = useId();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState("");
  const { position } = useAnchoredEpisodePopover(open, triggerRef, "end", placement === "footer" ? "top" : "bottom");
  const current = ranges.find((range) => range.page === page) ?? ranges[0];
  const previous = ranges.find((range) => range.page === page - 1);
  const next = ranges.find((range) => range.page === page + 1);

  useEffect(() => {
    if (!open || !desktop) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[aria-current='page']")?.focus());
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [desktop, open]);

  if (!current || ranges.length < 2) return null;

  function choosePage(target: number) {
    setOpen(false);
    onPageChange(target);
  }

  function closeAndFocusTrigger() {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
  }

  function jumpToEpisode() {
    const target = Number.parseInt(episodeNumber, 10);
    if (!Number.isInteger(target) || target < 1) return;
    setOpen(false);
    setEpisodeNumber("");
    onEpisodeJump(target);
  }

  const picker = (
    <>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-semibold">{t("library.episodeRangeChoose")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("library.episodeRangeCurrent", { first: current.firstEpisodeNumber, last: current.lastEpisodeNumber, total })}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" data-dialog-close aria-label={t("library.episodeRangeClose")} onClick={closeAndFocusTrigger}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid gap-1" aria-labelledby={titleId}>
          {ranges.map((range) => (
            <button
              key={range.page}
              type="button"
              aria-current={range.page === page ? "page" : undefined}
              className="flex min-h-11 items-center justify-between rounded-xl px-3 text-left text-sm font-medium hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              onClick={() => choosePage(range.page)}
            >
              <span>{t("library.episodeRangeOption", { first: range.firstEpisodeNumber, last: range.lastEpisodeNumber })}</span>
              {range.page === page ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <form className="mt-3 flex gap-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); jumpToEpisode(); }}>
          <Input value={episodeNumber} inputMode="numeric" aria-label={t("library.episodeRangeJump")} placeholder={t("library.episodeRangeJumpPlaceholder")} onChange={(event) => setEpisodeNumber(event.target.value)} />
          <Button type="submit" disabled={!/^\d+$/.test(episodeNumber) || Number(episodeNumber) < 1}>{t("library.confirm")}</Button>
        </form>
      </div>
    </>
  );

  return (
    <nav className="flex items-center justify-center gap-1" aria-label={t("library.episodeRangeNavigator")}>
      {placement === "footer" || desktop ? (
        <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={disabled || !previous} aria-label={t("library.episodeRangePrevious")} onClick={() => previous && choosePage(previous.page)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      <div ref={triggerRef}>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-1.5 px-3 tabular-nums"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          {current.firstEpisodeNumber}-{current.lastEpisodeNumber}
          <ChevronDown className={`h-4 w-4 ${placement === "footer" ? "rotate-180" : ""}`} aria-hidden="true" />
        </Button>
      </div>
      {placement === "footer" || desktop ? (
        <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={disabled || !next} aria-label={t("library.episodeRangeNext")} onClick={() => next && choosePage(next.page)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      {desktop && open && position && typeof document !== "undefined" ? createPortal(
        <div ref={panelRef} style={position} className="glass-dialog fixed flex max-h-[min(70vh,32rem)] w-80 flex-col overflow-hidden rounded-2xl border text-foreground" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          {picker}
        </div>,
        document.body,
      ) : null}
      {!desktop ? (
        <ModalSurface
          open={open}
          titleId={titleId}
          panelClassName="mt-auto max-h-[min(82svh,36rem)] rounded-t-[var(--radius-modal)] pb-[env(safe-area-inset-bottom)]"
          initialFocusSelector="[aria-current='page']"
          onClose={closeAndFocusTrigger}
        >
          {picker}
        </ModalSurface>
      ) : null}
    </nav>
  );
}
