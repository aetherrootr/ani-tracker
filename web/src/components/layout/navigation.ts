import { BookOpen, Search, Settings } from "lucide-react";

import type { TranslationKey } from "@/i18n";

export const navigationItems = [
  { href: "/tracking-list", labelKey: "nav.trackingList", icon: BookOpen },
  { href: "/search", labelKey: "nav.search", icon: Search },
] satisfies Array<{
  href: string;
  labelKey: TranslationKey;
  icon: typeof BookOpen;
}>;

export const settingsNavigationItem = {
  href: "/settings",
  labelKey: "nav.settings",
  icon: Settings,
} satisfies {
  href: string;
  labelKey: TranslationKey;
  icon: typeof BookOpen;
};
