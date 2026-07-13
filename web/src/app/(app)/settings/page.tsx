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
import { useCurrentUser, useLogout, useUnlinkOidc, useUpdateImportProviderPreference, useUpdateIncludeUnwatchedSeasonZeroInStatistics, useUpdateIncludeUnwatchedSeasonZeroInTracking, useUpdateWeekStartDay } from "@/features/auth/hooks";
import { getCurrentLibraryRefreshJob, getImportProviders, getLibraryRefreshJob, syncAllLibraryAnime } from "@/features/library/api";
import type { ImportProvider, LibraryRefreshJob } from "@/features/library/types";
import { getApiUrl } from "@/lib/api-client";

const WEEK_START_OPTIONS = ["0", "1", "2", "3", "4", "5", "6"] as const;
const BOOLEAN_OPTIONS = ["true", "false"] as const;

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const logout = useLogout();
  const unlinkOidc = useUnlinkOidc();
  const updateWeekStartDay = useUpdateWeekStartDay();
  const updateImportProviderPreference = useUpdateImportProviderPreference();
  const updateIncludeUnwatchedSeasonZeroInTracking = useUpdateIncludeUnwatchedSeasonZeroInTracking();
  const updateIncludeUnwatchedSeasonZeroInStatistics = useUpdateIncludeUnwatchedSeasonZeroInStatistics();
  const { user } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUnlinkingOidc, setIsUnlinkingOidc] = useState(false);
  const [isUnlinkConfirmOpen, setIsUnlinkConfirmOpen] = useState(false);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [isSavingWeekStart, setIsSavingWeekStart] = useState(false);
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isSavingSeasonZero, setIsSavingSeasonZero] = useState(false);
  const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
  const [isLoadingLibraryRefreshJob, setIsLoadingLibraryRefreshJob] = useState(true);
  const [libraryRefreshJob, setLibraryRefreshJob] = useState<LibraryRefreshJob | null>(null);
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
    getCurrentLibraryRefreshJob(controller.signal)
      .then(setLibraryRefreshJob)
      .catch(() => undefined)
      .finally(() => setIsLoadingLibraryRefreshJob(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!libraryRefreshJob || libraryRefreshJob.status === "completed" || libraryRefreshJob.status === "failed") {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      getLibraryRefreshJob(libraryRefreshJob.jobId, controller.signal)
        .then(setLibraryRefreshJob)
        .catch(() => undefined);
    }, 1500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [libraryRefreshJob]);

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

  async function handleSeasonZeroTrackingChange(value: (typeof BOOLEAN_OPTIONS)[number]) {
    setIsSavingSeasonZero(true);
    try {
      await updateIncludeUnwatchedSeasonZeroInTracking(value === "true");
    } finally {
      setIsSavingSeasonZero(false);
    }
  }

  async function handleSeasonZeroStatisticsChange(value: (typeof BOOLEAN_OPTIONS)[number]) {
    setIsSavingSeasonZero(true);
    try {
      await updateIncludeUnwatchedSeasonZeroInStatistics(value === "true");
    } finally {
      setIsSavingSeasonZero(false);
    }
  }

  async function handleSyncAllLibrary() {
    setIsSyncingLibrary(true);
    setSyncLibraryMessage(null);

    try {
      const response = await syncAllLibraryAnime();
      setLibraryRefreshJob(response.job);
      setSyncLibraryMessage(response.queued ? t("settings.librarySync.queued") : t("settings.librarySync.alreadyRunning"));
    } catch {
      setSyncLibraryMessage(t("settings.librarySync.failed"));
    } finally {
      setIsSyncingLibrary(false);
    }
  }

  const hasActiveLibraryRefreshJob = libraryRefreshJob?.status === "queued" || libraryRefreshJob?.status === "running";
  const libraryRefreshProgress = libraryRefreshJob?.progress;

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
          <CardTitle>{t("settings.seasonZero.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.seasonZero.description")}</span>
            <BadgeLikeStatus>{isSavingSeasonZero ? t("settings.seasonZero.saving") : t("settings.seasonZero.saved")}</BadgeLikeStatus>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border p-4">
              <Label>{t("settings.seasonZero.tracking")}</Label>
              <p>{t("settings.seasonZero.trackingDescription")}</p>
              <SlidingOptionGroup
                options={BOOLEAN_OPTIONS}
                value={user?.includeUnwatchedSeasonZeroInTracking ? "true" : "false"}
                render={(value) => t(`settings.seasonZero.boolean.${value}`)}
                onChange={handleSeasonZeroTrackingChange}
                className="max-w-xs"
              />
            </div>
            <div className="space-y-2 rounded-lg border p-4">
              <Label>{t("settings.seasonZero.statistics")}</Label>
              <p>{t("settings.seasonZero.statisticsDescription")}</p>
              <SlidingOptionGroup
                options={BOOLEAN_OPTIONS}
                value={user?.includeUnwatchedSeasonZeroInStatistics ? "true" : "false"}
                render={(value) => t(`settings.seasonZero.boolean.${value}`)}
                onChange={handleSeasonZeroStatisticsChange}
                className="max-w-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.librarySync.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>{t("settings.librarySync.description")}</p>
            {syncLibraryMessage ? <p className="font-medium text-foreground">{syncLibraryMessage}</p> : null}
          </div>
          <Button variant="outline" onClick={handleSyncAllLibrary} disabled={isSyncingLibrary || isLoadingLibraryRefreshJob || hasActiveLibraryRefreshJob}>
            {hasActiveLibraryRefreshJob ? t("settings.librarySync.running") : isSyncingLibrary ? t("settings.librarySync.syncing") : t("settings.librarySync.button")}
          </Button>
          </div>
          {libraryRefreshProgress ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-foreground">{t(`settings.librarySync.stages.${libraryRefreshProgress.stage}`)}</span>
                <span>{libraryRefreshProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${libraryRefreshProgress.percent}%` }} />
              </div>
              <p>{libraryRefreshProgress.message}</p>
            </div>
          ) : null}
          {libraryRefreshJob?.summary ? <LibraryRefreshSummary summary={libraryRefreshJob.summary} /> : null}
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

function LibraryRefreshSummary({ summary }: { summary: Record<string, unknown> }) {
  const t = useTranslations();
  const sync = isRecord(summary.sync) ? summary.sync : null;
  const discovery = isRecord(summary.tvdbSeasonDiscovery) ? summary.tvdbSeasonDiscovery : null;
  if (!sync && !discovery) {
    return null;
  }
  return (
    <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label={t("settings.librarySync.summary.checked")} value={numberField(sync, "checked")} />
      <Metric label={t("settings.librarySync.summary.synced")} value={numberField(sync, "synced")} />
      <Metric label={t("settings.librarySync.summary.importedSeasons")} value={numberField(discovery, "imported")} />
      <Metric label={t("settings.librarySync.summary.failed")} value={numberField(sync, "failed") + numberField(discovery, "failed")} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberField(value: Record<string, unknown> | null, key: string) {
  const field = value?.[key];
  return typeof field === "number" ? field : 0;
}

function BadgeLikeStatus({ children }: { children: ReactNode }) {
  return <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}
