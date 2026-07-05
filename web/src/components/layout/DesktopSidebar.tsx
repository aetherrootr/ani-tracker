"use client";

import { useTranslations } from "next-intl";
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
  const settingsActive =
    pathname === settingsNavigationItem.href ||
    pathname.startsWith(`${settingsNavigationItem.href}/`);

  return (
    <aside className="hidden w-72 shrink-0 border-r bg-card/80 px-4 py-5 md:sticky md:top-0 md:flex md:h-screen md:self-start md:flex-col md:overflow-y-auto">
      <Link href="/tracking-list" className="mb-8 flex items-center gap-3 px-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          A
        </div>
        <div>
          <p className="font-semibold tracking-tight">Ani Tracker</p>
        </div>
      </Link>

      <nav className="space-y-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border bg-background p-4">
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
