import { BarChart3, CalendarDays, ListTodo, Library, Search, Settings } from "lucide-react";

import type { TranslationKey } from "@/i18n";

const destinations = {
  tracking: { href: "/tracking-list", labelKey: "nav.trackingList", icon: ListTodo },
  calendar: { href: "/calendar", labelKey: "nav.airingCalendar", icon: CalendarDays, ariaLabelKey: "nav.airingCalendarFull" },
  library: { href: "/library", labelKey: "nav.library", icon: Library },
  search: { href: "/search", labelKey: "nav.search", icon: Search },
  statistics: { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3 },
} satisfies Record<string, {
  href: string;
  labelKey: TranslationKey;
  icon: typeof ListTodo;
  ariaLabelKey?: TranslationKey;
}>;

export const desktopNavigationItems = [
  destinations.tracking,
  destinations.calendar,
  destinations.library,
  destinations.search,
  destinations.statistics,
] as const;

export const mobileNavigationItems = [
  destinations.tracking,
  { ...destinations.calendar, labelKey: "nav.calendar" as TranslationKey },
  destinations.library,
  destinations.search,
] as const;

export const mobileSecondaryNavigationItems = [
  destinations.statistics,
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
] satisfies Array<{
  href: string;
  labelKey: TranslationKey;
  icon: typeof ListTodo;
}>;

export const settingsNavigationItem = {
  href: "/settings",
  labelKey: "nav.settings",
  icon: Settings,
} satisfies {
  href: string;
  labelKey: TranslationKey;
  icon: typeof ListTodo;
};

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
