"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { ConfirmDialog } from "@/components/library/ConfirmDialog";
import { TvtimeImportCard } from "@/components/settings/TvtimeImportCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { getOidcConfig, updatePassword } from "@/features/auth/api";
import { useCurrentUser, useLogout, useUnlinkOidc, useUpdateImportProviderPreference, useUpdateWeekStartDay } from "@/features/auth/hooks";
import { getImportProviders, syncAllLibraryAnime } from "@/features/library/api";
import type { ImportProvider } from "@/features/library/types";
import { getApiUrl } from "@/lib/api-client";

const WEEK_START_OPTIONS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const logout = useLogout();
  const unlinkOidc = useUnlinkOidc();
  const updateWeekStartDay = useUpdateWeekStartDay();
  const updateImportProviderPreference = useUpdateImportProviderPreference();
  const { user } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUnlinkingOidc, setIsUnlinkingOidc] = useState(false);
  const [isUnlinkConfirmOpen, setIsUnlinkConfirmOpen] = useState(false);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [isSavingWeekStart, setIsSavingWeekStart] = useState(false);
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
  const [syncLibraryMessage, setSyncLibraryMessage] = useState<string | null>(null);
  const [passwordCardOpen, setPasswordCardOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [isPasswordConfirmOpen, setIsPasswordConfirmOpen] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

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

  useEffect(() => {
    const controller = new AbortController();
    getImportProviders(controller.signal)
      .then((response) => setProviders(response.providers))
      .catch(() => setProviders([]));
    return () => controller.abort();
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

  async function handleProviderPreferenceChange(value: string) {
    setIsSavingProvider(true);

    try {
      await updateImportProviderPreference(value);
    } finally {
      setIsSavingProvider(false);
    }
  }

  async function handleSyncAllLibrary() {
    setIsSyncingLibrary(true);
    setSyncLibraryMessage(null);

    try {
      await syncAllLibraryAnime();
      setSyncLibraryMessage(t("settings.librarySync.queued"));
    } catch {
      setSyncLibraryMessage(t("settings.librarySync.failed"));
    } finally {
      setIsSyncingLibrary(false);
    }
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setPasswordError(t("settings.password.tooShort"));
      return;
    }
    setPasswordError(null);
    setIsPasswordConfirmOpen(true);
  }

  async function handlePasswordReset() {
    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      await updatePassword({ password: newPassword });
      setNewPassword("");
      setPasswordMessage(t("settings.password.saved"));
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t("settings.password.failed"));
    } finally {
      setIsSavingPassword(false);
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
          <CardTitle>{t("settings.provider.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.provider.description")}</span>
            <BadgeLikeStatus>{isSavingProvider ? t("settings.provider.saving") : t("settings.provider.saved")}</BadgeLikeStatus>
          </div>
          {providers.length > 0 ? (
            <SlidingOptionGroup
              options={providers.map((provider) => provider.name)}
              value={user?.importProviderPreference && providers.some((provider) => provider.name === user.importProviderPreference) ? user.importProviderPreference : providers[0].name}
              render={(value) => providers.find((provider) => provider.name === value)?.label ?? value}
              onChange={handleProviderPreferenceChange}
              className="max-w-3xl"
              buttonClassName="text-xs sm:text-sm"
            />
          ) : (
            <p>{t("settings.provider.empty")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.librarySync.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>{t("settings.librarySync.description")}</p>
            {syncLibraryMessage ? <p className="font-medium text-foreground">{syncLibraryMessage}</p> : null}
          </div>
          <Button variant="outline" onClick={handleSyncAllLibrary} disabled={isSyncingLibrary}>
            {isSyncingLibrary ? t("settings.librarySync.syncing") : t("settings.librarySync.button")}
          </Button>
        </CardContent>
      </Card>
      <TvtimeImportCard />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("settings.password.title")}</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setPasswordCardOpen((current) => !current)}>
            {passwordCardOpen ? t("settings.password.collapse") : t("settings.password.expand")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <p>{t(user?.oidcLinked ? "settings.password.oidcDescription" : "settings.password.description")}</p>
          {passwordCardOpen ? (
            <form className="space-y-4" onSubmit={handlePasswordSubmit}>
              <div className="max-w-sm space-y-2">
                <Label htmlFor="new-password">{t("settings.password.newPassword")}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setPasswordError(null);
                    setPasswordMessage(null);
                  }}
                />
              </div>
              {passwordError ? <p className="font-medium text-destructive">{passwordError}</p> : null}
              {passwordMessage ? <p className="font-medium text-foreground">{passwordMessage}</p> : null}
              <Button type="submit" variant="outline" disabled={isSavingPassword || !newPassword}>
                {isSavingPassword ? t("settings.password.saving") : t("settings.password.button")}
              </Button>
            </form>
          ) : null}
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
                onClick={() => window.location.assign(getApiUrl("/api/oidc/link"))}
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
      <ConfirmDialog
        open={isPasswordConfirmOpen}
        title={t("settings.password.confirmTitle")}
        description={t("settings.password.confirmDescription")}
        confirmLabel={t("settings.password.confirm")}
        onCancel={() => setIsPasswordConfirmOpen(false)}
        onConfirm={() => {
          setIsPasswordConfirmOpen(false);
          void handlePasswordReset();
        }}
      />
    </div>
  );
}

function BadgeLikeStatus({ children }: { children: ReactNode }) {
  return <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}
