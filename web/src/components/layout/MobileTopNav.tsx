"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { navigationItems, settingsNavigationItem } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function MobileTopNav() {
  const pathname = usePathname();
  const t = useTranslations();
  const SettingsIcon = settingsNavigationItem.icon;
  const settingsActive =
    pathname === settingsNavigationItem.href ||
    pathname.startsWith(`${settingsNavigationItem.href}/`);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/tracking-list" className="font-semibold tracking-tight">
          Ani Tracker
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href={settingsNavigationItem.href}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              settingsActive && "bg-accent text-accent-foreground",
            )}
            aria-label={t(settingsNavigationItem.labelKey)}
          >
            <SettingsIcon className="h-5 w-5" />
          </Link>
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
