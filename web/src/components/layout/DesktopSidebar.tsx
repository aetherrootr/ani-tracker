"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppLogoMark } from "@/components/ui/app-logo-mark";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrentUser } from "@/features/auth/hooks";
import { cn } from "@/lib/utils";

import { isNavigationItemActive, navigationItems, settingsNavigationItem } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function DesktopSidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { user } = useCurrentUser();

  const displayName = user?.displayName || user?.username || t("app.currentUser");
  const SettingsIcon = settingsNavigationItem.icon;
  const settingsActive = isNavigationItemActive(pathname, settingsNavigationItem.href);

  return (
    <aside className="desktop-sidebar navigation-surface hidden shrink-0 border-r px-4">
      <ScrollArea ariaLabel={t("app.scrollableContent")} className="min-h-0 flex-1" viewportClassName="flex h-full flex-col">
      <Link href="/tracking-list" draggable={false} className="navigation-focus mb-8 flex select-none items-center gap-3 rounded-[var(--radius-control)] px-3 py-2">
        <AppLogoMark className="h-10 w-10" />
        <div>
          <p className="font-semibold tracking-tight">Ani Tracker</p>
        </div>
      </Link>

      <nav className="space-y-1" aria-label={t("nav.mainNavigation")}>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = isNavigationItemActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              draggable={false}
              className={cn(
                "navigation-focus flex h-11 select-none items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted-foreground transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-hover)] hover:text-foreground active:bg-[var(--surface-pressed)]",
                active && "bg-[var(--accent-soft)] text-[var(--accent-solid)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-solid)]",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="navigation-account-group mt-auto rounded-[var(--radius-panel)] border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-card)] text-sm font-semibold shadow-[var(--shadow-low)]">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {user?.email ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p> : null}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <ThemeToggle />
          <Link
            href={settingsNavigationItem.href}
            draggable={false}
            className={cn(
              "navigation-focus interactive-surface inline-flex h-11 flex-1 select-none items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground active:bg-[var(--surface-pressed)]",
              settingsActive && "bg-[var(--accent-soft)] text-[var(--accent-solid)]",
            )}
            aria-label={t(settingsNavigationItem.labelKey)}
            aria-current={settingsActive ? "page" : undefined}
          >
            <SettingsIcon className="h-4 w-4" />
            <span>{t(settingsNavigationItem.labelKey)}</span>
          </Link>
        </div>
      </div>
      </ScrollArea>
    </aside>
  );
}
