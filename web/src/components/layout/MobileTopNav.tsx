"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { appLogoUrl } from "@/lib/app-logo";
import { cn } from "@/lib/utils";

import { navigationItems, settingsNavigationItem } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function MobileTopNav() {
  const pathname = usePathname();
  const t = useTranslations();
  const SettingsIcon = settingsNavigationItem.icon;
  const activeNavigationIndex = navigationItems.findIndex(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const settingsActive =
    pathname === settingsNavigationItem.href ||
    pathname.startsWith(`${settingsNavigationItem.href}/`);

  return (
    <header className="glass-surface fixed inset-x-0 top-0 z-[100] h-[var(--mobile-top-nav-height)] border-b md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/tracking-list" className="flex items-center gap-2 font-semibold tracking-tight">
          <Image
            src={appLogoUrl}
            alt="Ani Tracker"
            width={32}
            height={32}
            className="h-8 w-8 rounded-xl object-cover"
            priority
            unoptimized
          />
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
      <nav className="relative mx-3 mb-3 grid grid-cols-4 gap-1 rounded-2xl p-1">
        {activeNavigationIndex >= 0 ? (
          <div className="pointer-events-none absolute inset-1 grid grid-cols-4 gap-1" aria-hidden="true">
            <div
              className="rounded-xl bg-primary shadow-md transition-[grid-column] duration-300 ease-out"
              style={{ gridColumnStart: activeNavigationIndex + 1 }}
            />
          </div>
        ) : null}
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative z-10 flex min-h-10 items-center justify-center gap-2 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors duration-300",
                active && "text-primary-foreground",
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
