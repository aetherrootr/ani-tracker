"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useLocaleControls } from "@/i18n/provider";

export function LanguageToggle() {
  const { locale, setLocale } = useLocaleControls();
  const t = useTranslations();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-2"
      aria-label={t("app.language")}
      onClick={() => setLocale(nextLocale)}
    >
      <Languages className="h-4 w-4" />
      <span>{locale === "zh-CN" ? "中文" : "EN"}</span>
    </Button>
  );
}
