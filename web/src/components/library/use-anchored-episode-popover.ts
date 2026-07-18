"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

import { useDesktopPlatform } from "@/components/layout/platform-layout";

const PANEL_WIDTH = 320;
const VIEWPORT_MARGIN = 16;
const ANCHOR_GAP = 8;

export function useAnchoredEpisodePopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  align: "start" | "end",
  side: "top" | "bottom" = "bottom",
) {
  const desktop = useDesktopPlatform();
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !desktop) {
      return;
    }

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const preferredLeft = align === "start" ? rect.left : rect.right - PANEL_WIDTH;
      setPosition({
        ...(side === "top"
          ? { bottom: Math.round(Math.max(window.innerHeight - rect.top + ANCHOR_GAP, VIEWPORT_MARGIN)) }
          : { top: Math.round(rect.bottom + ANCHOR_GAP) }),
        left: Math.round(Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN)),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchorRef, desktop, open, side]);

  return { desktop, position };
}
