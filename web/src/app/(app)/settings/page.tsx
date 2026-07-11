"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { ConfirmDialog } from "@/components/library/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { getOidcConfig } from "@/features/auth/api";
import { useCurrentUser, useLogout, useUnlinkOidc, useUpdateWeekStartDay } from "@/features/auth/hooks";
import { getApiUrl } from "@/lib/api-client";

const WEEK_START_OPTIONS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const logout = useLogout();
  const unlinkOidc = useUnlinkOidc();
  const updateWeekStartDay = useUpdateWeekStartDay();
  const { user } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUnlinkingOidc, setIsUnlinkingOidc] = useState(false);
  const [isUnlinkConfirmOpen, setIsUnlinkConfirmOpen] = useState(false);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [isSavingWeekStart, setIsSavingWeekStart] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getOidcConfig()
      .then((config) => {
        if (isMounted) {
          setIsOidcEnabled(config.enabled);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsOidcEnabled(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleUnlinkOidc() {
    setIsUnlinkingOidc(true);

    try {
      await unlinkOidc();
    } finally {
      setIsUnlinkingOidc(false);
    }
  }

  async function handleWeekStartDayChange(value: (typeof WEEK_START_OPTIONS)[number]) {
    setIsSavingWeekStart(true);

    try {
      await updateWeekStartDay(Number(value));
    } finally {
      setIsSavingWeekStart(false);
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
          <CardTitle>{t("settings.weekStart.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.weekStart.description")}</span>
            <BadgeLikeStatus>{isSavingWeekStart ? t("settings.weekStart.saving") : t("settings.weekStart.saved")}</BadgeLikeStatus>
          </div>
          <SlidingOptionGroup
            options={WEEK_START_OPTIONS}
            value={String(user?.weekStartDay ?? 0) as (typeof WEEK_START_OPTIONS)[number]}
            render={(value) => t(`settings.weekStart.days.${value}`)}
            onChange={handleWeekStartDayChange}
            className="max-w-3xl"
            buttonClassName="text-xs sm:text-sm"
          />
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
        {isOidcEnabled ? (
          <CardContent className="flex items-center justify-between gap-4 border-t pt-6 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">
              {user?.oidcLinked ? t("settings.account.ssoLinked") : t("settings.account.ssoUnlinked")}
            </p>
            {user?.oidcLinked ? (
              <Button variant="outline" onClick={() => setIsUnlinkConfirmOpen(true)} disabled={isUnlinkingOidc}>
                {isUnlinkingOidc ? t("settings.account.unlinkingSso") : t("settings.account.unlinkSso")}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => window.location.assign(getApiUrl("/api/auth/oidc/link"))}
              >
                {t("settings.account.linkSso")}
              </Button>
            )}
          </CardContent>
        ) : null}
      </Card>
      <ConfirmDialog
        open={isUnlinkConfirmOpen}
        title={t("settings.account.unlinkSsoConfirmTitle")}
        description={t("settings.account.unlinkSsoConfirmDescription")}
        confirmLabel={t("settings.account.unlinkSso")}
        danger
        onCancel={() => setIsUnlinkConfirmOpen(false)}
        onConfirm={() => {
          setIsUnlinkConfirmOpen(false);
          void handleUnlinkOidc();
        }}
      />
    </div>
  );
}

function BadgeLikeStatus({ children }: { children: ReactNode }) {
  return <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}
