import type { ReactNode } from "react";

import { AppMainScrollArea } from "./AppMainScrollArea";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileTopNav } from "./MobileTopNav";
import { PwaInstallPrompt } from "./PwaInstallPrompt";
import { UserWallpaper } from "./UserWallpaper";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div id="app-shell" className="app-shell overflow-hidden">
      <UserWallpaper />
      <DesktopSidebar />
      <PwaInstallPrompt />
      <div className="app-shell-content min-w-0 flex-1 overflow-hidden">
        <MobileTopNav />
        <AppMainScrollArea>{children}</AppMainScrollArea>
      </div>
    </div>
  );
}
