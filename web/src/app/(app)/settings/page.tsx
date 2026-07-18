"use client";

import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Link2, LogOut, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { TvtimeImportCard } from "@/components/settings/TvtimeImportCard";
import { WallpaperSettingsCard } from "@/components/settings/WallpaperSettingsCard";
import { Button } from "@/components/ui/button";
import { AppLogoMark } from "@/components/ui/app-logo-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboboxField } from "@/components/ui/combobox-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SelectField } from "@/components/ui/select-field";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { getOidcConfig, getOidcPasswordSetupStatus, updatePassword } from "@/features/auth/api";
import { useCurrentUser, useLogout, useUnlinkOidc, useUpdateImportProviderPreference, useUpdateIncludeUnwatchedSeasonZeroInStatistics, useUpdateIncludeUnwatchedSeasonZeroInTracking, useUpdateTimeZonePreference, useUpdateWeekStartDay } from "@/features/auth/hooks";
import { getCurrentLibraryRefreshJob, getImportProviders, getLibraryRefreshJob, syncAllLibraryAnime, syncFailedLibraryAnime } from "@/features/library/api";
import type { ImportProvider, LibraryRefreshFailedAnime, LibraryRefreshJob } from "@/features/library/types";
import { getApiUrl } from "@/lib/api-client";

const WEEK_START_OPTIONS = ["0", "1", "2", "3", "4", "5", "6"] as const;
const TIME_ZONE_MODE_OPTIONS = ["auto", "manual"] as const;
type BooleanOption = "true" | "false";

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const logout = useLogout();
  const unlinkOidc = useUnlinkOidc();
  const updateWeekStartDay = useUpdateWeekStartDay();
  const updateTimeZonePreference = useUpdateTimeZonePreference();
  const updateImportProviderPreference = useUpdateImportProviderPreference();
  const updateIncludeUnwatchedSeasonZeroInTracking = useUpdateIncludeUnwatchedSeasonZeroInTracking();
  const updateIncludeUnwatchedSeasonZeroInStatistics = useUpdateIncludeUnwatchedSeasonZeroInStatistics();
  const { user } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUnlinkingOidc, setIsUnlinkingOidc] = useState(false);
  const [unlinkPanelOpen, setUnlinkPanelOpen] = useState(false);
  const [unlinkPassword, setUnlinkPassword] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [oidcPasswordSetupAuthorized, setOidcPasswordSetupAuthorized] = useState(false);
  const [passwordEnabledOverride, setPasswordEnabledOverride] = useState(false);
  const [isSavingWeekStart, setIsSavingWeekStart] = useState(false);
  const [isSavingTimeZone, setIsSavingTimeZone] = useState(false);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ImportProvider[]>([]);
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isSavingSeasonZeroTracking, setIsSavingSeasonZeroTracking] = useState(false);
  const [isSavingSeasonZeroStatistics, setIsSavingSeasonZeroStatistics] = useState(false);
  const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
  const [isLoadingLibraryRefreshJob, setIsLoadingLibraryRefreshJob] = useState(true);
  const [libraryRefreshJob, setLibraryRefreshJob] = useState<LibraryRefreshJob | null>(null);
  const [syncLibraryMessage, setSyncLibraryMessage] = useState<string | null>(null);
  const [passwordCardOpen, setPasswordCardOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [aboutCardOpen, setAboutCardOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    getOidcConfig()
      .then((config) => {
        if (isMounted) {
          setIsOidcEnabled(config.enabled);
          if (config.enabled) {
            void getOidcPasswordSetupStatus()
              .then((status) => {
                if (isMounted) setOidcPasswordSetupAuthorized(status.authorized);
              })
              .catch(() => undefined);
          }
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
    setAccountError(null);

    try {
      await logout();
      router.push("/login");
    } catch {
      setAccountError(t("settings.account.logoutFailed"));
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleUnlinkOidc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUnlinkingOidc(true);
    setAccountError(null);

    try {
      await unlinkOidc(unlinkPassword);
      setUnlinkPassword("");
      setUnlinkPanelOpen(false);
    } catch {
      setAccountError(t("settings.account.reauthenticationFailed"));
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

  async function handleTimeZoneModeChange(mode: (typeof TIME_ZONE_MODE_OPTIONS)[number]) {
    setIsSavingTimeZone(true);
    setTimeZoneError(null);
    const timeZone = mode === "auto" ? getBrowserTimeZone() : user?.timeZone || "UTC";
    try {
      await updateTimeZonePreference(mode, timeZone);
    } catch {
      setTimeZoneError(t("settings.timeZone.invalid"));
    } finally {
      setIsSavingTimeZone(false);
    }
  }

  async function handleManualTimeZoneChange(timeZone: string) {
    if (!timeZone) return;
    setIsSavingTimeZone(true);
    setTimeZoneError(null);
    try {
      await updateTimeZonePreference("manual", timeZone);
    } catch {
      setTimeZoneError(t("settings.timeZone.invalid"));
    } finally {
      setIsSavingTimeZone(false);
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

  async function handleSeasonZeroTrackingChange(value: BooleanOption) {
    setIsSavingSeasonZeroTracking(true);
    try {
      await updateIncludeUnwatchedSeasonZeroInTracking(value === "true");
    } finally {
      setIsSavingSeasonZeroTracking(false);
    }
  }

  async function handleSeasonZeroStatisticsChange(value: BooleanOption) {
    setIsSavingSeasonZeroStatistics(true);
    try {
      await updateIncludeUnwatchedSeasonZeroInStatistics(value === "true");
    } finally {
      setIsSavingSeasonZeroStatistics(false);
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

  async function handleSyncFailedLibrary() {
    setIsSyncingLibrary(true);
    setSyncLibraryMessage(null);

    try {
      const response = await syncFailedLibraryAnime();
      setLibraryRefreshJob(response.job);
      setSyncLibraryMessage(response.queued ? t("settings.librarySync.retryQueued") : t("settings.librarySync.alreadyRunning"));
    } catch {
      setSyncLibraryMessage(t("settings.librarySync.retryFailed"));
    } finally {
      setIsSyncingLibrary(false);
    }
  }

  const hasActiveLibraryRefreshJob = libraryRefreshJob?.status === "queued" || libraryRefreshJob?.status === "running";
  const libraryRefreshCompleted = libraryRefreshJob?.status === "completed";
  const libraryRefreshFailed = libraryRefreshJob?.status === "failed";
  const libraryRefreshProgress = libraryRefreshJob?.progress;
  const failedAnime = failedAnimeFromSummary(libraryRefreshJob?.summary);
  const canRetryFailedLibraryRefresh = failedAnime.length > 0 && !hasActiveLibraryRefreshJob;

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setPasswordError(t("settings.password.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.password.mismatch"));
      return;
    }
    if (!currentPassword && !oidcPasswordSetupAuthorized) {
      setPasswordError(t("settings.password.currentRequired"));
      return;
    }
    setPasswordError(null);
    void handlePasswordReset();
  }

  async function handlePasswordReset() {
    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      await updatePassword({ ...(oidcPasswordSetupAuthorized ? {} : { currentPassword }), newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOidcPasswordSetupAuthorized(false);
      setPasswordEnabledOverride(true);
      setPasswordMessage(t("settings.password.saved"));
    } catch {
      setPasswordError(t("settings.password.reauthenticationFailed"));
    } finally {
      setIsSavingPassword(false);
    }
  }

  const passwordLoginEnabled = Boolean(user?.passwordLoginEnabled || passwordEnabledOverride);

  return (
    <div className="space-y-6">
      <header className="page-heading-surface">
        <h1 className="text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("settings.description")}</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-navigation mobile-sticky-below-top-nav sticky" aria-label={t("settings.categories.label") }>
          <a href="#settings-general">{t("settings.categories.general")}</a>
          <a href="#settings-tracking">{t("settings.categories.tracking")}</a>
          <a href="#settings-data">{t("settings.categories.data")}</a>
          <a href="#settings-maintenance">{t("settings.categories.maintenance")}</a>
          <a href="#settings-account">{t("settings.categories.account")}</a>
          <a href="#settings-about">{t("settings.categories.about")}</a>
        </nav>
        <div className="settings-content-pane">
      <section id="settings-general" className="settings-section" aria-labelledby="settings-general-heading">
        <h2 id="settings-general-heading">{t("settings.categories.general")}</h2>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 text-sm leading-6 text-muted-foreground">
          <span>{t("settings.language.description")}</span>
          <LanguageToggle />
        </CardContent>
      </Card>
      <WallpaperSettingsCard />
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.timeZone.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p>{t("settings.timeZone.description")}</p>
              <p className="mt-1 text-xs">{t("settings.timeZone.current", { timeZone: user?.timeZone ?? "UTC" })}</p>
            </div>
            {isSavingTimeZone ? <BadgeLikeStatus>{t("settings.timeZone.saving")}</BadgeLikeStatus> : null}
          </div>
          <SlidingOptionGroup
            ariaLabel={t("settings.timeZone.modeLabel")}
            options={TIME_ZONE_MODE_OPTIONS}
            value={user?.timeZoneMode ?? "auto"}
            render={(value) => t(`settings.timeZone.modes.${value}`)}
            onChange={handleTimeZoneModeChange}
            className="max-w-md"
          />
          {user?.timeZoneMode === "manual" ? (
            <div className="max-w-lg">
              <ComboboxField
                label={t("settings.timeZone.ianaLabel")}
                value={user.timeZone}
                options={getSupportedTimeZones()}
                placeholder={t("settings.timeZone.searchPlaceholder")}
                emptyMessage={t("settings.timeZone.noResults")}
                disabled={isSavingTimeZone}
                onValueChange={(timeZone) => void handleManualTimeZoneChange(timeZone)}
              />
            </div>
          ) : null}
          {timeZoneError ? <p role="alert" className="text-sm text-destructive">{timeZoneError}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.weekStart.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.weekStart.description")}</span>
            {isSavingWeekStart ? <BadgeLikeStatus>{t("settings.weekStart.saving")}</BadgeLikeStatus> : null}
          </div>
          <div className="hidden sm:block">
            <SlidingOptionGroup
              ariaLabel={t("settings.weekStart.title")}
              options={WEEK_START_OPTIONS}
              value={String(user?.weekStartDay ?? 0) as (typeof WEEK_START_OPTIONS)[number]}
              render={(value) => t(`settings.weekStart.days.${value}`)}
              onChange={handleWeekStartDayChange}
              className="max-w-3xl"
              buttonClassName="min-h-8 text-xs sm:text-sm"
            />
          </div>
          <div className="sm:hidden">
            <SelectField
              label={t("settings.weekStart.title")}
              value={String(user?.weekStartDay ?? 0) as (typeof WEEK_START_OPTIONS)[number]}
              options={WEEK_START_OPTIONS.map((value) => ({ value, label: t(`settings.weekStart.days.${value}`) }))}
              onValueChange={handleWeekStartDayChange}
            />
          </div>
        </CardContent>
      </Card>
      </section>
      <section id="settings-data" className="settings-section" aria-labelledby="settings-data-heading">
        <h2 id="settings-data-heading">{t("settings.categories.data")}</h2>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.provider.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.provider.description")}</span>
            {isSavingProvider ? <BadgeLikeStatus>{t("settings.provider.saving")}</BadgeLikeStatus> : null}
          </div>
          {providers.length > 1 ? (
            <div className="max-w-sm">
              <SelectField
                label={t("settings.provider.selectLabel")}
                hideLabel
                disabled={isSavingProvider}
                options={providers.map((provider) => ({ value: provider.name, label: provider.label }))}
                value={user?.importProviderPreference && providers.some((provider) => provider.name === user.importProviderPreference) ? user.importProviderPreference : providers[0].name}
                onValueChange={(value) => void handleProviderPreferenceChange(value)}
              />
            </div>
          ) : providers.length === 1 ? (
            <div className="flex min-h-11 max-w-sm items-center justify-between rounded-[var(--radius-control)] border bg-secondary px-4 text-foreground">
              <span className="font-medium">{providers[0].label}</span>
              <span className="text-xs text-muted-foreground">{t("settings.provider.onlyOne")}</span>
            </div>
          ) : (
            <p>{t("settings.provider.empty")}</p>
          )}
        </CardContent>
      </Card>
      </section>
      <section id="settings-tracking" className="settings-section" aria-labelledby="settings-tracking-heading">
        <h2 id="settings-tracking-heading">{t("settings.categories.tracking")}</h2>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.seasonZero.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>{t("settings.seasonZero.description")}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="settings-toggle-row">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium text-foreground">{t("settings.seasonZero.tracking")}</h3>
                <p>{t("settings.seasonZero.trackingDescription")}</p>
              </div>
               <SettingsSwitch
                 label={t("settings.seasonZero.tracking")}
                 checked={Boolean(user?.includeUnwatchedSeasonZeroInTracking)}
                 disabled={isSavingSeasonZeroTracking}
                 onChange={(checked) => void handleSeasonZeroTrackingChange(checked ? "true" : "false")}
               />
            </div>
            <div className="settings-toggle-row">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium text-foreground">{t("settings.seasonZero.statistics")}</h3>
                <p>{t("settings.seasonZero.statisticsDescription")}</p>
              </div>
               <SettingsSwitch
                 label={t("settings.seasonZero.statistics")}
                 checked={Boolean(user?.includeUnwatchedSeasonZeroInStatistics)}
                 disabled={isSavingSeasonZeroStatistics}
                 onChange={(checked) => void handleSeasonZeroStatisticsChange(checked ? "true" : "false")}
               />
            </div>
          </div>
        </CardContent>
      </Card>
      </section>
      <section id="settings-maintenance" className="settings-section" aria-labelledby="settings-maintenance-heading">
        <h2 id="settings-maintenance-heading">{t("settings.categories.maintenance")}</h2>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.librarySync.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>{t("settings.librarySync.description")}</p>
            {syncLibraryMessage ? <p role="status" className="font-medium text-foreground">{syncLibraryMessage}</p> : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleSyncAllLibrary} disabled={isSyncingLibrary || isLoadingLibraryRefreshJob || hasActiveLibraryRefreshJob}>
              {hasActiveLibraryRefreshJob ? t("settings.librarySync.running") : isSyncingLibrary ? t("settings.librarySync.syncing") : t("settings.librarySync.button")}
            </Button>
            {canRetryFailedLibraryRefresh ? (
              <Button variant="outline" onClick={handleSyncFailedLibrary} disabled={isSyncingLibrary || isLoadingLibraryRefreshJob}>
                {isSyncingLibrary ? t("settings.librarySync.syncing") : t("settings.librarySync.retryFailedButton", { count: failedAnime.length })}
              </Button>
            ) : null}
          </div>
          </div>
          {libraryRefreshProgress && hasActiveLibraryRefreshJob ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-foreground">{t(`settings.librarySync.stages.${libraryRefreshProgress.stage}`)}</span>
                <span>{libraryRefreshProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={t(`settings.librarySync.stages.${libraryRefreshProgress.stage}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={libraryRefreshProgress.percent}>
                <div className="library-refresh-progress h-full bg-[var(--accent-solid)]" style={{ width: `${libraryRefreshProgress.percent}%` }} />
              </div>
              <p>{libraryRefreshProgress.message}</p>
              {libraryRefreshProgress.details ? <LibraryRefreshProgressDetails details={libraryRefreshProgress.details} /> : null}
            </div>
          ) : null}
          {libraryRefreshCompleted ? (
            <div role="status" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--watched)_28%,transparent)] bg-[color-mix(in_srgb,var(--watched)_10%,var(--surface-card))] p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-[var(--watched)]" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">{t("settings.librarySync.completedTitle")}</p>
                <p>{t("settings.librarySync.completedDescription")}</p>
              </div>
            </div>
          ) : null}
          {libraryRefreshFailed ? (
            <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-4 text-destructive">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
              <div>
                <p className="font-medium">{t("settings.librarySync.failedTitle")}</p>
                <p>{t("settings.librarySync.failedDescription")}</p>
              </div>
            </div>
          ) : null}
          {libraryRefreshJob?.summary ? <LibraryRefreshSummary summary={libraryRefreshJob.summary} /> : null}
          {failedAnime.length > 0 && libraryRefreshJob ? <LibraryRefreshFailures job={libraryRefreshJob} failedAnime={failedAnime} /> : null}
        </CardContent>
      </Card>
      <TvtimeImportCard />
      </section>
      <section id="settings-account" className="settings-section" aria-labelledby="settings-account-heading">
        <h2 id="settings-account-heading">{t("settings.categories.account")}</h2>
      <Card>
        <CardContent className="p-0 text-sm leading-6 text-muted-foreground">
          <AccountRow icon={<UserRound />} title={t("settings.account.profile")} description={t("settings.account.profileDescription")}>
            <div className="text-right">
              <p className="font-medium text-foreground">{user?.displayName || user?.username}</p>
              <p className="text-xs">{user?.email}</p>
            </div>
          </AccountRow>

          <div className="border-t">
            <AccountRow icon={<KeyRound />} title={t("settings.password.title")} description={passwordLoginEnabled ? t("settings.password.description") : t("settings.password.notSetDescription")}>
              <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 font-semibold text-foreground hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" aria-expanded={passwordCardOpen} aria-controls="password-settings-panel" onClick={() => setPasswordCardOpen((current) => !current)}>
                <span>{passwordCardOpen ? t("settings.password.collapse") : passwordLoginEnabled ? t("settings.password.change") : t("settings.password.setPassword")}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${passwordCardOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </AccountRow>
            {passwordCardOpen ? (
              <div id="password-settings-panel" className="grid gap-4 border-t border-[var(--divider)] bg-[color-mix(in_srgb,var(--surface-panel)_72%,transparent)] px-5 pb-5 pt-4 md:pl-[4.5rem]">
                {user?.oidcLinked && !oidcPasswordSetupAuthorized ? (
                  <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border bg-[var(--surface-card)] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p>{passwordLoginEnabled ? t("settings.password.oidcResetDescription") : t("settings.password.oidcSetupDescription")}</p>
                    <Button type="button" variant="outline" className="min-h-11 flex-none" onClick={() => window.location.assign(getApiUrl("/api/oidc/password-setup"))}>{t("settings.password.verifyWithOidc")}</Button>
                  </div>
                ) : null}
                {passwordLoginEnabled || oidcPasswordSetupAuthorized ? (
                  <form className="grid gap-4" onSubmit={handlePasswordSubmit} aria-busy={isSavingPassword}>
                    <div className={`grid max-w-3xl gap-4 ${oidcPasswordSetupAuthorized ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
                      {!oidcPasswordSetupAuthorized ? <PasswordField id="current-password" label={t("settings.password.currentPassword")} autoComplete="current-password" value={currentPassword} onChange={(value) => { setCurrentPassword(value); setPasswordError(null); setPasswordMessage(null); }} /> : null}
                      <PasswordField id="new-password" label={t("settings.password.newPassword")} autoComplete="new-password" value={newPassword} onChange={(value) => { setNewPassword(value); setPasswordError(null); setPasswordMessage(null); }} />
                      <PasswordField id="confirm-password" label={t("settings.password.confirmPassword")} autoComplete="new-password" value={confirmPassword} onChange={(value) => { setConfirmPassword(value); setPasswordError(null); setPasswordMessage(null); }} />
                    </div>
                    {oidcPasswordSetupAuthorized ? <p role="status" className="font-medium text-[var(--watched)]">{t("settings.password.oidcVerified")}</p> : null}
                    <p className="text-xs">{t("settings.password.requirements")}</p>
                    {passwordError ? <p role="alert" className="font-medium text-destructive">{passwordError}</p> : null}
                    {passwordMessage ? <p role="status" className="font-medium text-[var(--watched)]">{passwordMessage}</p> : null}
                    <Button type="submit" className="min-h-11" disabled={isSavingPassword || (!oidcPasswordSetupAuthorized && !currentPassword) || !newPassword || !confirmPassword}>
                      {isSavingPassword ? t("settings.password.saving") : passwordLoginEnabled ? t("settings.password.button") : t("settings.password.setPassword")}
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>

          {isOidcEnabled ? (
            <div className="border-t">
              <AccountRow icon={<Link2 />} title={t("settings.account.organizationLogin")} description={user?.oidcLinked ? t("settings.account.ssoLinked") : t("settings.account.ssoUnlinked")}>
                {user?.oidcLinked && passwordLoginEnabled ? (
                  <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 font-semibold text-foreground hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" aria-expanded={unlinkPanelOpen} aria-controls="oidc-unlink-panel" onClick={() => setUnlinkPanelOpen((current) => !current)}>
                    <span>{t("settings.account.manageSso")}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${unlinkPanelOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                ) : user?.oidcLinked ? <span className="text-xs font-medium text-[var(--warning)]">{t("settings.account.setPasswordBeforeUnlink")}</span> : <Button variant="outline" className="min-h-11" onClick={() => window.location.assign(getApiUrl("/api/oidc/link"))}>{t("settings.account.linkSso")}</Button>}
              </AccountRow>
              {user?.oidcLinked && unlinkPanelOpen ? (
                <form id="oidc-unlink-panel" className="grid gap-4 border-t border-[var(--divider)] bg-[color-mix(in_srgb,var(--surface-panel)_72%,transparent)] px-5 pb-5 pt-4 md:pl-[4.5rem]" onSubmit={handleUnlinkOidc}>
                  <p>{t("settings.account.unlinkReauthentication")}</p>
                  <div className="max-w-sm"><PasswordField id="unlink-current-password" label={t("settings.password.currentPassword")} autoComplete="current-password" value={unlinkPassword} onChange={(value) => { setUnlinkPassword(value); setAccountError(null); }} /></div>
                  <Button type="submit" variant="outline" className="min-h-11 border-destructive/30 text-destructive hover:bg-destructive/10" disabled={isUnlinkingOidc || !unlinkPassword}>{isUnlinkingOidc ? t("settings.account.unlinkingSso") : t("settings.account.unlinkSso")}</Button>
                </form>
              ) : null}
            </div>
          ) : null}

          <div className="border-t">
            <AccountRow icon={<LogOut />} title={t("settings.account.currentSession")} description={t("settings.account.description")}>
              <Button className="min-h-11" variant="outline" onClick={handleLogout} disabled={isLoggingOut}>{isLoggingOut ? t("app.loggingOut") : t("app.logout")}</Button>
            </AccountRow>
          </div>
          {accountError ? <p role="alert" className="mx-4 mb-4 rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-3 text-destructive">{accountError}</p> : null}
        </CardContent>
      </Card>
      </section>
      <section id="settings-about" className="settings-section" aria-labelledby="settings-about-heading">
        <h2 id="settings-about-heading">{t("settings.categories.about")}</h2>
      <Card>
        <button type="button" className="flex min-h-20 w-full items-center gap-4 px-5 py-4 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[var(--accent-glow)]" aria-expanded={aboutCardOpen} aria-controls="about-settings-panel" onClick={() => setAboutCardOpen((current) => !current)}>
          <AppLogoMark className="h-11 w-11 flex-none" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-foreground">Ani Tracker</span>
            <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">{t("settings.about.summary")}</span>
          </span>
          <ChevronDown className={`h-5 w-5 flex-none text-muted-foreground transition-transform ${aboutCardOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {aboutCardOpen ? (
          <CardContent id="about-settings-panel" className="grid gap-6 border-t px-5 pb-5 pt-5 text-sm leading-6 text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
            <div className="space-y-5">
              <section aria-labelledby="about-product-heading" className="space-y-2">
                <h3 id="about-product-heading" className="font-semibold text-foreground">{t("settings.about.productTitle")}</h3>
                <p>{t("settings.about.description")}</p>
                <p>{t("settings.about.noMedia")}</p>
              </section>
              <section aria-labelledby="about-responsibility-heading" className="space-y-2">
                <h3 id="about-responsibility-heading" className="font-semibold text-foreground">{t("settings.about.responsibilityTitle")}</h3>
                <p>{t("settings.about.responsibility")}</p>
              </section>
            </div>
            <section aria-labelledby="about-sources-heading" className="space-y-3">
              <div>
                <h3 id="about-sources-heading" className="font-semibold text-foreground">{t("settings.about.sourcesTitle")}</h3>
                <p>{t("settings.about.metadataIntro")}</p>
              </div>
              <div className="divide-y overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface-card)]">
                <AboutLink href="https://bangumi.tv/about/copyright">Bangumi</AboutLink>
                <AboutLink href="https://www.themoviedb.org/api-terms-of-use">TMDB</AboutLink>
                <AboutLink href="https://www.thetvdb.com/api-information#attribution">TVDB</AboutLink>
              </div>
            </section>
          </CardContent>
        ) : null}
      </Card>
      </section>
        </div>
      </div>
    </div>
  );
}

function AccountRow({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[5.5rem] items-center gap-4 px-5 py-4 max-sm:flex-wrap max-sm:items-start max-sm:gap-3 max-sm:p-4">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-solid)] [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium text-foreground">{title}</h3>
        <p>{description}</p>
      </div>
      <div className="max-w-[min(45%,28rem)] flex-none max-sm:w-full max-sm:max-w-none max-sm:pl-12 max-sm:text-left">{children}</div>
    </div>
  );
}

function PasswordField({ id, label, autoComplete, value, onChange }: { id: string; label: string; autoComplete: "current-password" | "new-password"; value: string; onChange: (value: string) => void }) {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} name={id} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} className="pr-12" onChange={(event) => onChange(event.target.value)} required />
        <button type="button" className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-input)] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" aria-label={visible ? t("auth.login.hidePassword") : t("auth.login.showPassword")} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function AboutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 font-medium text-foreground hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-glow)]" href={href} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <ExternalLink className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
    </a>
  );
}

function LibraryRefreshProgressDetails({ details }: { details: NonNullable<LibraryRefreshJob["progress"]>["details"] }) {
  const t = useTranslations();
  if (!details) {
    return null;
  }
  return (
    <div className="grid gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
      {typeof details.synced === "number" ? <Metric label={t("settings.librarySync.summary.synced")} value={details.synced} /> : null}
      {typeof details.imported === "number" ? <Metric label={t("settings.librarySync.summary.imported")} value={details.imported} /> : null}
      {typeof details.existing === "number" ? <Metric label={t("settings.librarySync.summary.existing")} value={details.existing} /> : null}
      {typeof details.skipped === "number" ? <Metric label={t("settings.librarySync.summary.skipped")} value={details.skipped} /> : null}
      <Metric label={t("settings.librarySync.summary.failed")} value={details.failed} />
      {typeof details.episodeConflicts === "number" ? <Metric label={t("settings.librarySync.summary.episodeConflicts")} value={details.episodeConflicts} /> : null}
      <Metric label={t("settings.librarySync.summary.postersQueued")} value={details.postersQueued} />
      {details.currentAnime ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <div className="text-xs uppercase tracking-wide">{t("settings.librarySync.currentAnime")}</div>
          <div className="font-medium text-foreground">{details.currentAnime.title}</div>
        </div>
      ) : null}
    </div>
  );
}

function LibraryRefreshSummary({ summary }: { summary: Record<string, unknown> }) {
  const t = useTranslations();
  const sync = isRecord(summary.sync) ? summary.sync : null;
  const tvdbDiscovery = isRecord(summary.tvdbSeasonDiscovery) ? summary.tvdbSeasonDiscovery : null;
  const bangumiDiscovery = isRecord(summary.bangumiRelatedAnimeDiscovery) ? summary.bangumiRelatedAnimeDiscovery : null;
  if (!sync && !tvdbDiscovery && !bangumiDiscovery) {
    return null;
  }
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <SummarySection title={t("settings.librarySync.summary.metadata")}> 
        <Metric label={t("settings.librarySync.summary.checked")} value={numberField(sync, "checked")} />
        <Metric label={t("settings.librarySync.summary.synced")} value={numberField(sync, "synced")} />
        <Metric label={t("settings.librarySync.summary.episodeConflicts")} value={numberField(sync, "episodeConflicts")} />
        <Metric label={t("settings.librarySync.summary.failed")} value={numberField(sync, "failed")} />
      </SummarySection>
      {tvdbDiscovery ? (
        <SummarySection title={t("settings.librarySync.summary.tvdbSeasons")}>
          <Metric label={t("settings.librarySync.summary.checked")} value={numberField(tvdbDiscovery, "checked")} />
          <Metric label={t("settings.librarySync.summary.imported")} value={numberField(tvdbDiscovery, "imported")} />
          <Metric label={t("settings.librarySync.summary.existing")} value={numberField(tvdbDiscovery, "existing")} />
          <Metric label={t("settings.librarySync.summary.failed")} value={numberField(tvdbDiscovery, "failed")} />
        </SummarySection>
      ) : null}
      {bangumiDiscovery ? (
        <SummarySection title={t("settings.librarySync.summary.bangumiRelatedAnime")}>
          <Metric label={t("settings.librarySync.summary.checked")} value={numberField(bangumiDiscovery, "checked")} />
          <Metric label={t("settings.librarySync.summary.imported")} value={numberField(bangumiDiscovery, "imported")} />
          <Metric label={t("settings.librarySync.summary.existing")} value={numberField(bangumiDiscovery, "existing")} />
          <Metric label={t("settings.librarySync.summary.failed")} value={numberField(bangumiDiscovery, "failed")} />
        </SummarySection>
      ) : null}
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-foreground">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function LibraryRefreshFailures({ job, failedAnime }: { job: LibraryRefreshJob; failedAnime: LibraryRefreshFailedAnime[] }) {
  const t = useTranslations();
  return (
    <div className="space-y-2 rounded-lg border border-destructive/30 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-medium text-foreground">{t("settings.librarySync.failedAnimeTitle", { count: failedAnime.length })}</div>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadLibraryRefreshErrorReport(job, failedAnime)}>
          {t("settings.librarySync.downloadErrorReport")}
        </Button>
      </div>
      <ScrollArea ariaLabel={t("app.scrollableContent")} className="max-h-48" viewportClassName="max-h-48 space-y-2 pr-1">
        {failedAnime.map((anime) => (
          <div key={anime.animeId} className="rounded-md bg-secondary px-3 py-2">
            <div className="font-medium text-secondary-foreground">{anime.title}</div>
            {anime.error ? <div className="text-xs text-muted-foreground">{anime.error}</div> : null}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}

function downloadLibraryRefreshErrorReport(job: LibraryRefreshJob, failedAnime: LibraryRefreshFailedAnime[]) {
  const report = {
    generatedAt: new Date().toISOString(),
    jobId: job.jobId,
    status: job.status,
    retryFailedOnly: job.retryFailedOnly === true,
    progress: job.progress,
    summary: job.summary,
    failedAnime,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `library-refresh-errors-${job.jobId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getSupportedTimeZones() {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/Los_Angeles", "America/New_York"];
}

function failedAnimeFromSummary(summary: Record<string, unknown> | null | undefined): LibraryRefreshFailedAnime[] {
  const sync = isRecord(summary?.sync) ? summary.sync : null;
  const failedAnime = sync?.failedAnime;
  if (!Array.isArray(failedAnime)) {
    return [];
  }
  return failedAnime.flatMap((item) => {
    if (!isRecord(item) || typeof item.animeId !== "number" || typeof item.title !== "string") {
      return [];
    }
    return [{ animeId: item.animeId, title: item.title, error: typeof item.error === "string" ? item.error : undefined }];
  });
}

function BadgeLikeStatus({ children }: { children: ReactNode }) {
  return <span role="status" className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}

function SettingsSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className="settings-switch"
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}
