"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppLogoMark } from "@/components/ui/app-logo-mark";
import { cn } from "@/lib/utils";

import { isNavigationItemActive, navigationItems, settingsNavigationItem } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function MobileTopNav() {
  const pathname = usePathname();
  const t = useTranslations();
  const SettingsIcon = settingsNavigationItem.icon;
  const activeNavigationIndex = navigationItems.findIndex((item) =>
    isNavigationItemActive(pathname, item.href),
  );
  const settingsActive = isNavigationItemActive(pathname, settingsNavigationItem.href);

  return (
    <header className="mobile-top-nav mobile-navigation-shell layer-navigation fixed inset-x-0 top-0 h-[var(--mobile-top-nav-height)] border-b">
      <div className="mobile-navigation-layout">
        <div className="mobile-navigation-toolbar">
          <Link href="/tracking-list" draggable={false} className="mobile-navigation-brand mobile-navigation-focus select-none">
            <AppLogoMark className="h-8 w-8" />
            <span className="mobile-navigation-brand-name">Ani Tracker</span>
          </Link>
          <div className="mobile-navigation-tools">
            <ThemeToggle />
            <Link
              href={settingsNavigationItem.href}
              draggable={false}
              className={cn(
                "mobile-navigation-tool mobile-navigation-focus select-none",
                settingsActive && "mobile-navigation-tool-current",
              )}
              aria-label={t(settingsNavigationItem.labelKey)}
              aria-current={settingsActive ? "page" : undefined}
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>
          </div>
        </div>
        <nav className="mobile-navigation-track" aria-label={t("nav.mainNavigation")}>
          {activeNavigationIndex >= 0 ? (
            <span
              className="mobile-navigation-thumb"
              style={{
                transform: `translateX(calc(${activeNavigationIndex * 100}% + ${activeNavigationIndex * 0.25}rem))`,
              }}
              aria-hidden="true"
            />
          ) : null}
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = isNavigationItemActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                draggable={false}
                className="mobile-navigation-destination mobile-navigation-focus select-none"
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
