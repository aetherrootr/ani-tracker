"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type ModalSurfaceProps = {
  open: boolean;
  titleId: string;
  descriptionId?: string;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  initialFocusSelector?: string;
  busy?: boolean;
  onClose: () => void;
};

export function ModalSurface({
  open,
  titleId,
  descriptionId,
  children,
  className,
  panelClassName,
  initialFocusSelector = "[data-dialog-close]",
  busy = false,
  onClose,
}: ModalSurfaceProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeDialog = useEffectEvent(onClose);
  const dialogIsBusy = useEffectEvent(() => busy);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const previousInert = appShell?.inert ?? false;
    const previousOverflow = scrollContainer?.style.overflow ?? "";

    appShell?.setAttribute("inert", "");
    if (scrollContainer) scrollContainer.style.overflow = "hidden";
    document.documentElement.classList.add("dialog-scroll-lock");
    document.body.classList.add("dialog-scroll-lock");

    const frame = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(initialFocusSelector);
      (target ?? panelRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !dialogIsBusy()) {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
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

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (appShell && !previousInert) appShell.removeAttribute("inert");
      if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
      document.documentElement.classList.remove("dialog-scroll-lock");
      document.body.classList.remove("dialog-scroll-lock");
      previouslyFocused?.focus();
    };
  }, [initialFocusSelector, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("modal-layer mobile-fixed-below-top-nav fixed inset-0 flex items-stretch justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4", className)}
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cn("glass-dialog flex w-full flex-col overflow-hidden border text-foreground outline-none", panelClassName)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
