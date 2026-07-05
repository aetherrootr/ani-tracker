"use client";

import { useTranslations } from "next-intl";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("settings.description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 text-sm leading-6 text-muted-foreground">
          <span>{t("settings.language.description")}</span>
          <LanguageToggle />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.backend.title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          {t("settings.backend.description")}
        </CardContent>
      </Card>
    </div>
  );
}
