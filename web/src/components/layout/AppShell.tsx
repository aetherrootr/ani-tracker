import type { ReactNode } from "react";

import { DesktopSidebar } from "./DesktopSidebar";
import { MobileTopNav } from "./MobileTopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <DesktopSidebar />
      <div className="min-w-0 flex-1">
        <MobileTopNav />
        <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
