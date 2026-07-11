import { BarChart3, ListTodo, Library, Search, Settings } from "lucide-react";

import type { TranslationKey } from "@/i18n";

export const navigationItems = [
  { href: "/tracking-list", labelKey: "nav.trackingList", icon: ListTodo },
  { href: "/library", labelKey: "nav.library", icon: Library },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3 },
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
