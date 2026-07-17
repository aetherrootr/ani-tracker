"use client";

import { useEffect, useEffectEvent, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const t = useTranslations();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelDialog = useEffectEvent(onCancel);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const previousInert = appShell?.inert ?? false;
    const previousScrollOverflow = scrollContainer?.style.overflow ?? "";
    appShell?.setAttribute("inert", "");
    if (scrollContainer) {
      scrollContainer.style.overflow = "hidden";
    }
    document.documentElement.classList.add("dialog-scroll-lock");
    document.body.classList.add("dialog-scroll-lock");

    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-dialog-cancel]")?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDialog();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (appShell && !previousInert) {
        appShell.removeAttribute("inert");
      }
      if (scrollContainer) {
        scrollContainer.style.overflow = previousScrollOverflow;
      }
      document.documentElement.classList.remove("dialog-scroll-lock");
      document.body.classList.remove("dialog-scroll-lock");
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div ref={dialogRef} className="glass-dialog w-full max-w-sm rounded-[var(--radius-modal)] border p-5 text-foreground" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" data-dialog-cancel onClick={onCancel}>{t("library.cancel")}</Button>
          <Button
            type="button"
            className={`${danger ? "bg-destructive text-white hover:bg-destructive/90 " : ""}min-h-11`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t("library.confirm")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
