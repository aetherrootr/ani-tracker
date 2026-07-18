"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

import { getMobileScrollContainer } from "./mobile-scroll-container";

export function MobileScrollRestorer() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    let secondFrame = 0;
    function resetScroll() {
      getMobileScrollContainer()?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }

    resetScroll();
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(resetScroll);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [pathname]);

  return null;
}
