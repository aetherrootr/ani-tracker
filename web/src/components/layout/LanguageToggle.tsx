"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCurrentUser, useUpdateLanguagePreference } from "@/features/auth/hooks";
import { useLocaleControls } from "@/i18n/provider";

export function LanguageToggle() {
  const { locale, setLocale } = useLocaleControls();
  const { user } = useCurrentUser();
  const updateLanguagePreference = useUpdateLanguagePreference();
  const t = useTranslations();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const [isUpdating, setIsUpdating] = useState(false);

  async function handleClick() {
    setLocale(nextLocale);

    if (!user) {
      return;
    }

    setIsUpdating(true);
    try {
      await updateLanguagePreference(nextLocale);
    } catch {
      setLocale(locale);
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-11 gap-2 px-3 md:min-h-8"
      aria-label={`${t("app.language")}: ${locale === "zh-CN" ? t("app.languageChinese") : t("app.languageEnglish")}`}
      disabled={isUpdating}
      onClick={handleClick}
    >
      <Languages className="h-4 w-4" />
      <span>{locale === "zh-CN" ? "中文" : "EN"}</span>
    </Button>
  );
}
