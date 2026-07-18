"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

import { MOBILE_SCROLL_CONTAINER_ID } from "./mobile-scroll-container";

export function AppMainScrollArea({ children }: { children: ReactNode }) {
  const t = useTranslations();

  return (
    <ScrollArea
      ariaLabel={t("app.scrollableContent")}
      className="app-main-scroll w-full"
      viewportAs="main"
      viewportId={MOBILE_SCROLL_CONTAINER_ID}
      viewportClassName="app-main h-full px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="app-content-plane">{children}</div>
    </ScrollArea>
  );
}
