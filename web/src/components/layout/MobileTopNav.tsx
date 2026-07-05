"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLogout } from "@/features/auth/hooks";
import { cn } from "@/lib/utils";

import { LanguageToggle } from "./LanguageToggle";
import { navigationItems } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function MobileTopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const logout = useLogout();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/tracking-list" className="font-semibold tracking-tight">
          Ani Tracker
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? t("app.loggingOut") : t("app.logout")}
          </Button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted-foreground",
                active && "bg-primary text-primary-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
