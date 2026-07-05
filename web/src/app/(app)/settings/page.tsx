"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLogout } from "@/features/auth/hooks";

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const logout = useLogout();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
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
          <CardTitle>{t("settings.account.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 text-sm leading-6 text-muted-foreground">
          <span>{t("settings.account.description")}</span>
          <Button variant="outline" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? t("app.loggingOut") : t("app.logout")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
