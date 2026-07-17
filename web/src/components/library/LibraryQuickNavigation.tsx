"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

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
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let frame: number | null = null;
    function updateAvailability() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const container = containerRef.current;
        if (!container) return;
        const sidebarRight = document.querySelector<HTMLElement>(".desktop-sidebar")?.getBoundingClientRect().right ?? 0;
        setAvailable(container.getBoundingClientRect().left >= sidebarRight + 12);
      });
    }
    updateAvailability();
    window.addEventListener("resize", updateAvailability);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAvailability);
    };
  }, []);

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
      <ScrollArea ref={viewportRef} className="library-anchor-scroll" ariaLabel={t("library.quickNavigationScrollbar")} showScrollbar={false}>
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
    </nav>
  );
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
