import type { ReactNode } from "react";

import { MobileTopNav } from "./MobileTopNav";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:hidden">
      <MobileTopNav />
      <main className="px-4 py-5">{children}</main>
    </div>
  );
}
