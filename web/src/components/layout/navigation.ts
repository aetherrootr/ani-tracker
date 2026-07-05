import { BookOpen, Search, Settings } from "lucide-react";

import type { TranslationKey } from "@/i18n";

export const navigationItems = [
  { href: "/tracking-list", labelKey: "nav.trackingList", icon: BookOpen },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
] satisfies Array<{
  href: string;
  labelKey: TranslationKey;
  icon: typeof BookOpen;
}>;
