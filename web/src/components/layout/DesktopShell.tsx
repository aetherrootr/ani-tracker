import type { ReactNode } from "react";

import { DesktopSidebar } from "./DesktopSidebar";

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="hidden min-h-screen md:flex">
      <DesktopSidebar />
      <main className="flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
