"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { AuthProvider } from "@/features/auth/auth-context";
import { LocaleProvider } from "@/i18n/provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <AuthProvider>{children}</AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
