import type { ReactNode } from "react";

import { AppMainScrollArea } from "./AppMainScrollArea";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileTopNav } from "./MobileTopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div id="app-shell" className="app-shell min-h-screen overflow-hidden">
      <DesktopSidebar />
      <div className="app-shell-content min-w-0 flex-1">
        <MobileTopNav />
        <AppMainScrollArea>{children}</AppMainScrollArea>
      </div>
    </div>
  );
}
