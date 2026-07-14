"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "@/features/auth/hooks";
import { cn } from "@/lib/utils";

import { navigationItems, settingsNavigationItem } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function DesktopSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { user } = useCurrentUser();

  const displayName = user?.displayName || user?.username || t("app.currentUser");
  const SettingsIcon = settingsNavigationItem.icon;
  const activeNavigationIndex = navigationItems.findIndex(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const settingsActive =
    pathname === settingsNavigationItem.href ||
    pathname.startsWith(`${settingsNavigationItem.href}/`);

  return (
    <aside className="glass-surface hidden w-72 shrink-0 border-r px-4 py-5 md:sticky md:top-0 md:flex md:h-screen md:self-start md:flex-col md:overflow-y-auto">
      <Link href="/tracking-list" className="mb-8 flex items-center gap-3 px-3">
        <Image
          src="/app-logo.svg"
          alt="Ani Tracker"
          width={40}
          height={40}
          className="h-10 w-10 rounded-2xl object-cover"
          priority
        />
        <div>
          <p className="font-semibold tracking-tight">Ani Tracker</p>
        </div>
      </Link>

      <nav className="relative space-y-1">
        {activeNavigationIndex >= 0 ? (
          <div
            className="absolute left-0 right-0 top-0 h-11 rounded-xl bg-primary transition-transform duration-300 ease-out"
            style={{ transform: `translateY(${activeNavigationIndex * 3}rem)` }}
            aria-hidden="true"
          />
        ) : null}
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative z-10 flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                active && "text-primary-foreground hover:bg-transparent hover:text-primary-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="glass-card mt-auto rounded-2xl border p-4">
        <p className="text-sm font-medium">{displayName}</p>
        {user?.email ? <p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p> : null}
        <div className="mt-4 flex items-center gap-2">
          <ThemeToggle />
          <Link
            href={settingsNavigationItem.href}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              settingsActive && "bg-accent text-accent-foreground",
            )}
            aria-label={t(settingsNavigationItem.labelKey)}
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
