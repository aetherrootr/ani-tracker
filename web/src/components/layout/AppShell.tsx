import type { ReactNode } from "react";

import { DesktopSidebar } from "./DesktopSidebar";
import { MOBILE_SCROLL_CONTAINER_ID } from "./mobile-scroll-container";
import { MobileTopNav } from "./MobileTopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-hidden md:flex md:overflow-visible">
      <DesktopSidebar />
      <div className="min-w-0 flex-1 md:min-h-screen">
        <MobileTopNav />
        <main
          id={MOBILE_SCROLL_CONTAINER_ID}
          className="mx-auto mt-[var(--mobile-top-nav-height)] h-[calc(100svh-var(--mobile-top-nav-height))] w-full max-w-7xl overflow-y-auto overscroll-contain px-4 py-5 md:mt-0 md:h-auto md:overflow-visible md:px-8 md:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
