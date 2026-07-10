"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [canShow, setCanShow] = useState(true);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  const updateIndicator = useCallback(() => {
    if (!activeAnchorKey) {
      setIndicator(null);
      return;
    }

    const button = buttonRefs.current.get(activeAnchorKey);
    if (!button) {
      setIndicator(null);
      return;
    }

    setIndicator({ top: button.offsetTop, height: button.offsetHeight });
  }, [activeAnchorKey]);

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(updateIndicator);
    return () => window.cancelAnimationFrame(frameId);
  }, [anchors, updateIndicator]);

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
        updateIndicator();
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
  }, [updateIndicator]);

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
      <div className="relative flex flex-col items-stretch gap-1 p-1.5">
        {indicator ? (
          <div
            className="absolute left-1.5 right-1.5 top-0 rounded-xl bg-primary shadow-md transition-[height,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
            style={{ height: indicator.height, transform: `translateY(${indicator.top}px)` }}
            aria-hidden="true"
          />
        ) : null}
        {anchors.map((anchor) => {
          const active = anchor.key === activeAnchorKey;
          return (
            <button
              key={anchor.key}
              ref={(element) => {
                if (element) {
                  buttonRefs.current.set(anchor.key, element);
                  return;
                }
                buttonRefs.current.delete(anchor.key);
              }}
              type="button"
              className={cn(
                "relative z-10 rounded-xl px-2.5 py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors backdrop-blur-xl hover:bg-background/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-background/20",
                active && "text-primary-foreground hover:bg-transparent hover:text-primary-foreground dark:hover:bg-transparent",
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
