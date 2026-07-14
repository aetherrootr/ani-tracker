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
import { getCurrentLibraryRefreshJob, getImportProviders, getLibraryRefreshJob, syncAllLibraryAnime, syncFailedLibraryAnime } from "@/features/library/api";
import type { ImportProvider, LibraryRefreshFailedAnime, LibraryRefreshJob } from "@/features/library/types";
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
  const [aboutCardOpen, setAboutCardOpen] = useState(false);

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
              {libraryRefreshProgress.details ? <LibraryRefreshProgressDetails details={libraryRefreshProgress.details} /> : null}
            </div>
          ) : null}
          {libraryRefreshJob?.summary ? <LibraryRefreshSummary summary={libraryRefreshJob.summary} /> : null}
          {failedAnime.length > 0 && libraryRefreshJob ? <LibraryRefreshFailures job={libraryRefreshJob} failedAnime={failedAnime} /> : null}
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
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("settings.about.title")}</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setAboutCardOpen((current) => !current)}>
            {aboutCardOpen ? t("settings.about.collapse") : t("settings.about.expand")}
          </Button>
        </CardHeader>
        {aboutCardOpen ? (
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>{t("settings.about.description")}</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("settings.about.noMedia")}</li>
              <li>
                {t("settings.about.metadataIntro")} <ProviderLink href="https://bangumi.tv/about/copyright">Bangumi</ProviderLink>, <ProviderLink href="https://www.themoviedb.org/api-terms-of-use">TMDB</ProviderLink>, <ProviderLink href="https://www.thetvdb.com/api-information#attribution">TVDB</ProviderLink>.
              </li>
              <li>{t("settings.about.responsibility")}</li>
            </ul>
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

function ProviderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="font-medium text-foreground underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
      {children}
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
      <div className="max-h-48 space-y-2 overflow-auto pr-1">
        {failedAnime.map((anime) => (
          <div key={anime.animeId} className="rounded-md bg-secondary px-3 py-2">
            <div className="font-medium text-secondary-foreground">{anime.title}</div>
            {anime.error ? <div className="text-xs text-muted-foreground">{anime.error}</div> : null}
          </div>
        ))}
      </div>
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
  return <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{children}</span>;
}
