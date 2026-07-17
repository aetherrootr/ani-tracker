"use client";

import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

import { MOBILE_SCROLL_CONTAINER_ID, subscribeToDocumentScrollMode, usesDocumentScrolling } from "./mobile-scroll-container";

export function AppMainScrollArea({ children }: { children: ReactNode }) {
  const t = useTranslations();

  useEffect(() => {
    function syncScrollMode() {
      document.documentElement.classList.toggle("document-scroll-mode", usesDocumentScrolling());
    }
    syncScrollMode();
    const unsubscribe = subscribeToDocumentScrollMode(syncScrollMode);
    return () => {
      unsubscribe();
      document.documentElement.classList.remove("document-scroll-mode");
    };
  }, []);

  return (
    <ScrollArea
      ariaLabel={t("app.scrollableContent")}
      className="app-main-scroll mt-[var(--mobile-top-nav-height)] h-[calc(var(--app-viewport-height)-var(--mobile-top-nav-height))] w-full"
      viewportAs="main"
      viewportId={MOBILE_SCROLL_CONTAINER_ID}
      viewportClassName="app-main h-full px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
    >
      {children}
    </ScrollArea>
  );
}
