"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { ThemeColorUpdater } from "@/components/layout/ThemeColorUpdater";
import { AuthProvider } from "@/features/auth/auth-context";
import { LocaleProvider } from "@/i18n/provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <AuthProvider>
          <ThemeColorUpdater />
          <NativeLinkDragGuard />
          {children}
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}

function NativeLinkDragGuard() {
  useEffect(() => {
    function preventUnintentionalLinkDrag(event: DragEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link || link.getAttribute("draggable") === "true" || link.hasAttribute("data-allow-native-drag")) return;
      event.preventDefault();
    }

    document.addEventListener("dragstart", preventUnintentionalLinkDrag, true);
    return () => document.removeEventListener("dragstart", preventUnintentionalLinkDrag, true);
  }, []);

  return null;
}
