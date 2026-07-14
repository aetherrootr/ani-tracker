"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

import { getMobileScrollContainer } from "./mobile-scroll-container";

export function MobileScrollRestorer() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    getMobileScrollContainer()?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return null;
}
