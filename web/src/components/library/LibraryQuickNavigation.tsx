"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { NavigationAnchor } from "@/features/library/types";

type Props = {
  anchors: NavigationAnchor[];
  activeAnchorKey: string | null;
  onAnchor: (anchor: NavigationAnchor) => void;
};

export function LibraryQuickNavigation({ anchors, activeAnchorKey, onAnchor }: Props) {
  const t = useTranslations();
  const containerRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [available, setAvailable] = useState(false);
  const [scrollState, setScrollState] = useState({ up: false, down: false });

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = viewport.scrollHeight - viewport.clientHeight;
    const next = { up: viewport.scrollTop > 2, down: viewport.scrollTop < max - 2 };
    setScrollState((current) => current.up === next.up && current.down === next.down ? current : next);
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    const sidebar = document.querySelector<HTMLElement>(".desktop-sidebar");
    function updateAvailability() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const container = containerRef.current;
        if (!container || !sidebar) return;
        const containerRect = container.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const minimumWidth = 6.5 * rootFontSize;
        const maximumWidth = 10 * rootFontSize;
        const availableWidth = containerRect.right - sidebarRect.right - 12;
        container.style.width = `${Math.min(Math.max(availableWidth, minimumWidth), maximumWidth)}px`;
        setAvailable(availableWidth >= minimumWidth && containerRect.right <= window.innerWidth);
      });
    }
    updateAvailability();
    const observer = new ResizeObserver(updateAvailability);
    if (sidebar) observer.observe(sidebar);
    if (containerRef.current?.parentElement) observer.observe(containerRef.current.parentElement);
    window.addEventListener("resize", updateAvailability);
    window.visualViewport?.addEventListener("resize", updateAvailability);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateAvailability);
      window.visualViewport?.removeEventListener("resize", updateAvailability);
    };
  }, [anchors.length]);

  useEffect(() => {
    if (!activeAnchorKey) return;
    const nav = viewportRef.current;
    const button = buttonRefs.current.get(activeAnchorKey);
    if (!nav || !button) return;

    const itemTop = button.offsetTop;
    const itemBottom = itemTop + button.offsetHeight;
    if (itemTop < nav.scrollTop) {
      nav.scrollTo({ top: itemTop, behavior: reducedMotion() ? "auto" : "smooth" });
    } else if (itemBottom > nav.scrollTop + nav.clientHeight) {
      nav.scrollTo({ top: itemBottom - nav.clientHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [activeAnchorKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = requestAnimationFrame(updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchors.length, updateScrollState]);

  function scrollAnchors(direction: 1 | -1) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      top: direction * Math.max(viewport.clientHeight * 0.72, 160),
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }

  if (anchors.length === 0) return null;

  return (
    <nav
      ref={containerRef}
      className="library-anchor-nav"
      aria-label={t("library.quickNavigation")}
      aria-hidden={!available || undefined}
      inert={!available}
      data-available={available}
    >
      <div className="library-anchor-panel floating-surface">
        <div className="library-anchor-heading">{t("library.quickNavigation")}</div>
        <ScrollArea ref={viewportRef} className="library-anchor-scroll" ariaLabel={t("library.quickNavigationScrollbar")} showScrollbar={false} onViewportScroll={updateScrollState}>
          <div className="library-anchor-list">
            {anchors.map((anchor) => {
              const active = anchor.key === activeAnchorKey;
              const label = anchor.key === "unknown" ? t("anime.unknown") : anchor.label;
              return (
                <button
                  key={anchor.key}
                  ref={(element) => {
                    if (element) buttonRefs.current.set(anchor.key, element);
                    else buttonRefs.current.delete(anchor.key);
                  }}
                  type="button"
                  className="library-anchor-item"
                  data-active={active}
                  aria-current={active ? "location" : undefined}
                  onClick={() => onAnchor(anchor)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="library-anchor-controls">
          <button type="button" aria-label={t("library.quickNavigationPrevious")} disabled={!scrollState.up} onClick={() => scrollAnchors(-1)}>
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" aria-label={t("library.quickNavigationNext")} disabled={!scrollState.down} onClick={() => scrollAnchors(1)}>
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
