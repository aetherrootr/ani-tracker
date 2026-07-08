"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { NavigationAnchor } from "@/features/library/types";
import { cn } from "@/lib/utils";

type Props = {
  anchors: NavigationAnchor[];
  activeAnchorKey: string | null;
  onAnchor: (anchor: NavigationAnchor) => void;
};

export function LibraryQuickNavigation({ anchors, activeAnchorKey, onAnchor }: Props) {
  const t = useTranslations();
  const navRef = useRef<HTMLElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [canShow, setCanShow] = useState(true);

  useEffect(() => {
    let frameId: number | null = null;

    function updateMaxHeight() {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const element = navRef.current;
        if (!element) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const top = rect.top;
        setMaxHeight(Math.max(160, window.innerHeight - top - 24));
        setCanShow(rect.left >= 304);
      });
    }

    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);
    window.addEventListener("scroll", updateMaxHeight, { passive: true });

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", updateMaxHeight);
      window.removeEventListener("scroll", updateMaxHeight);
    };
  }, []);

  if (anchors.length === 0) {
    return null;
  }

  return (
    <aside
      ref={navRef}
      className={cn(
        "sticky top-24 z-20 hidden w-28 -translate-x-[calc(100%+1rem)] overflow-y-auto overscroll-contain pb-2 scrollbar-none transition-opacity lg:block",
        !canShow && "pointer-events-none opacity-0",
      )}
      style={maxHeight ? { maxHeight } : undefined}
      aria-label="Library anchors"
    >
      <div className="flex flex-col items-stretch gap-1 p-1.5">
        {anchors.map((anchor) => {
          const active = anchor.key === activeAnchorKey;
          return (
            <button
              key={anchor.key}
              type="button"
              className={cn(
                "rounded-xl px-2.5 py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors backdrop-blur-xl hover:bg-background/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-background/20",
                active && "border border-primary/35 bg-primary/60 text-primary-foreground shadow-md hover:bg-primary/70 hover:text-primary-foreground dark:bg-primary/55 dark:hover:bg-primary/65",
              )}
              aria-current={active ? "location" : undefined}
              onClick={() => onAnchor(anchor)}
            >
              {anchor.key === "unknown" ? t("anime.unknown") : anchor.label}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
