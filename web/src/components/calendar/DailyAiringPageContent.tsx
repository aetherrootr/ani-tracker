"use client";

import { AlertCircle, CalendarDays, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useDesktopPlatform } from "@/components/layout/platform-layout";
import { Button } from "@/components/ui/button";
import { getAiringCalendar } from "@/features/calendar/api";
import type { AiringCalendarResponse } from "@/features/calendar/types";
import {
  getAiringAnimeRefreshJob,
  getCurrentAiringAnimeRefreshJob,
  syncAiringAnime,
} from "@/features/library/api";
import type { LibraryRefreshJob } from "@/features/library/types";
import { useLocaleControls } from "@/i18n/provider";

import { AiringAnimeCard, MobileAiringAnimeCard } from "./AiringAnimeCard";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

export function DailyAiringPageContent() {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const isDesktop = useDesktopPlatform();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [calendar, setCalendar] = useState<AiringCalendarResponse | null>(null);
  const [calendarError, setCalendarError] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarRefreshing, setCalendarRefreshing] = useState(false);
  const [job, setJob] = useState<LibraryRefreshJob | null>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobSubmitting, setJobSubmitting] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const completedJobsRef = useRef(new Set<string>());
  const calendarRef = useRef<AiringCalendarResponse | null>(null);

  const loadCalendar = useCallback(async (preserveContent: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (preserveContent) setCalendarRefreshing(true);
    else setCalendarLoading(true);
    setCalendarError(false);
    try {
      const response = await getAiringCalendar(controller.signal);
      const previousStartDate = calendarRef.current?.startDate;
      calendarRef.current = response;
      setCalendar(response);
      setSelectedDayIndex((current) => previousStartDate && previousStartDate !== response.startDate
        ? 0
        : Math.min(current, response.days.length - 1));
    } catch {
      if (!controller.signal.aborted) setCalendarError(true);
    } finally {
      if (!controller.signal.aborted) {
        setCalendarLoading(false);
        setCalendarRefreshing(false);
      }
    }
  }, []);

  const acceptJob = useCallback((nextJob: LibraryRefreshJob | null) => {
    setJob(nextJob);
    if (nextJob?.status === "completed" && !completedJobsRef.current.has(nextJob.jobId)) {
      completedJobsRef.current.add(nextJob.jobId);
      void loadCalendar(Boolean(calendarRef.current));
    }
  }, [loadCalendar]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadCalendar(false));
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current?.abort();
    };
  }, [loadCalendar]);

  useEffect(() => {
    const controller = new AbortController();
    getCurrentAiringAnimeRefreshJob(controller.signal)
      .then(acceptJob)
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setJobLoading(false);
      });
    return () => controller.abort();
  }, [acceptJob]);

  const jobId = job?.jobId;
  const jobStatus = job?.status;

  useEffect(() => {
    if (!jobId || !jobStatus || !ACTIVE_JOB_STATUSES.has(jobStatus)) return;
    const controller = new AbortController();
    let timer = 0;

    const poll = () => {
      if (document.visibilityState === "hidden") return;
      getAiringAnimeRefreshJob(jobId, controller.signal)
        .then(acceptJob)
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted && document.visibilityState !== "hidden") {
            timer = window.setTimeout(poll, 1500);
          }
        });
    };
    const resume = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "hidden") poll();
    };
    timer = window.setTimeout(poll, 1500);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [acceptJob, jobId, jobStatus]);

  const calendarStartDate = calendar?.startDate;
  const calendarTimeZone = calendar?.timeZone;

  useEffect(() => {
    if (!calendarStartDate || !calendarTimeZone) return;
    const verifyWindow = () => {
      if (document.visibilityState !== "hidden" && localDateInZone(calendarTimeZone) !== calendarStartDate) {
        void loadCalendar(true);
      }
    };
    const midnightCheck = window.setInterval(verifyWindow, 60_000);
    document.addEventListener("visibilitychange", verifyWindow);
    window.addEventListener("focus", verifyWindow);
    return () => {
      window.clearInterval(midnightCheck);
      document.removeEventListener("visibilitychange", verifyWindow);
      window.removeEventListener("focus", verifyWindow);
    };
  }, [calendarStartDate, calendarTimeZone, loadCalendar]);

  async function handleRefresh() {
    setJobSubmitting(true);
    try {
      const response = await syncAiringAnime();
      if (response.job) acceptJob(response.job);
      else {
        const current = await getAiringAnimeRefreshJob(response.taskId);
        acceptJob(current);
      }
    } catch {
      setJob({
        jobId: "submission-failed",
        status: "failed",
        progress: null,
        summary: null,
      });
    } finally {
      setJobSubmitting(false);
    }
  }

  const activeJob = Boolean(job && ACTIVE_JOB_STATUSES.has(job.status));
  const requestedDesktopDate = searchParams.get("date");
  const selectedDesktopDate = calendar?.days.some((day) => day.date === requestedDesktopDate)
    ? requestedDesktopDate
    : calendar?.startDate ?? null;
  const rangeLabel = calendar
    ? `${t("calendar.range")} · ${formatRange(calendar.startDate, calendar.endDate, locale)}`
    : t("calendar.range");

  return (
    <div className="daily-airing-page">
      {isDesktop ? (
        <DesktopCalendarHeader
          activeJob={activeJob}
          calendar={calendar}
          jobFailed={job?.status === "failed"}
          jobLoading={jobLoading}
          jobSubmitting={jobSubmitting}
          rangeLabel={rangeLabel}
          onRefresh={handleRefresh}
        />
      ) : (
        <MobileCalendarHeader
          activeJob={activeJob}
          calendar={calendar}
          jobFailed={job?.status === "failed"}
          jobLoading={jobLoading}
          jobSubmitting={jobSubmitting}
          rangeLabel={rangeLabel}
          onRefresh={handleRefresh}
        />
      )}

      {calendarError && calendar ? (
        <div className="daily-airing-inline-error" role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{t("calendar.staleLoadFailed")}</span>
          <button type="button" onClick={() => loadCalendar(true)}>{t("calendar.retry")}</button>
        </div>
      ) : null}
      <div aria-busy={calendarLoading || calendarRefreshing || undefined}>
        <p className="sr-only" role="status">{calendarLoading ? t("calendar.loading") : ""}</p>
        {calendarLoading && !calendar ? <CalendarSkeleton mobile={!isDesktop} /> : null}
        {!calendarLoading && !calendar ? (
          <LoadError onRetry={() => loadCalendar(false)} />
        ) : null}
        {calendar?.totalAnimeCount === 0 ? <EmptyCalendar /> : null}
        {calendar && calendar.totalAnimeCount > 0 ? (
          isDesktop ? (
            <DesktopAiringBrowser
              calendar={calendar}
              locale={locale}
              selectedDate={selectedDesktopDate ?? calendar.startDate}
              onSelectDate={(date) => {
                const params = new URLSearchParams(searchParams.toString());
                if (date === calendar.startDate) params.delete("date");
                else params.set("date", date);
                const query = params.toString();
                router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
              }}
            />
          ) : (
            <MobileAiringSchedule
              calendar={calendar}
              locale={locale}
              selectedDayIndex={selectedDayIndex}
              onSelectDay={setSelectedDayIndex}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

type CalendarHeaderProps = {
  activeJob: boolean;
  calendar: AiringCalendarResponse | null;
  jobFailed: boolean;
  jobLoading: boolean;
  jobSubmitting: boolean;
  rangeLabel: string;
  onRefresh: () => void;
};

function DesktopCalendarHeader(props: CalendarHeaderProps) {
  const t = useTranslations();
  return (
    <header className="daily-airing-page-header">
      <p className="daily-airing-eyebrow">{props.rangeLabel}</p>
      <div className="daily-airing-title-row">
        <h1 className="text-4xl font-semibold tracking-tight">{t("calendar.title")}</h1>
        <CalendarRefreshButton {...props} descriptionId="daily-airing-refresh-description" />
      </div>
      <div className="daily-airing-description-row">
        <p className="daily-airing-page-description">{t("calendar.description")}</p>
        <p id="daily-airing-refresh-description" className="daily-airing-refresh-description">
          {t("calendar.refreshDescription")}
        </p>
      </div>
      {props.calendar ? (
        <div className="daily-airing-overview">
          <strong className="daily-airing-week-total">
            <CalendarDays aria-hidden="true" />
            {t("calendar.weekTotal", { count: props.calendar.totalAnimeCount })}
          </strong>
          <span className="daily-airing-time-zone">{t("calendar.timeZone", { timeZone: props.calendar.timeZone })}</span>
        </div>
      ) : null}
    </header>
  );
}

function MobileCalendarHeader(props: CalendarHeaderProps) {
  const t = useTranslations();
  return (
    <header className="mobile-airing-header">
      <p className="mobile-airing-eyebrow">{props.rangeLabel}</p>
      <div className="mobile-airing-title-row">
        <h1>{t("calendar.title")}</h1>
      </div>
      {props.calendar ? (
        <p className="mobile-airing-summary">
          {t("calendar.range")} · {t("calendar.animeCount", { count: props.calendar.totalAnimeCount })}
        </p>
      ) : null}
      <p className="mobile-airing-description">{t("calendar.description")}</p>
      <div className="mobile-airing-maintenance-row">
        <CalendarRefreshButton {...props} mobile descriptionId="mobile-airing-refresh-description" />
        <p id="mobile-airing-refresh-description" className="mobile-airing-refresh-description">
          {t("calendar.refreshDescription")}
        </p>
      </div>
      {props.calendar ? (
        <p className="mobile-airing-time-zone">{t("calendar.timeZone", { timeZone: props.calendar.timeZone })}</p>
      ) : null}
    </header>
  );
}

function CalendarRefreshButton({
  activeJob,
  descriptionId,
  jobFailed,
  jobLoading,
  jobSubmitting,
  mobile = false,
  onRefresh,
}: CalendarHeaderProps & { descriptionId: string; mobile?: boolean }) {
  const t = useTranslations();
  return (
    <Button
      type="button"
      variant="outline"
      className={mobile ? "mobile-airing-refresh-button" : "daily-airing-refresh-button"}
      disabled={jobSubmitting || activeJob || jobLoading}
      aria-disabled={jobSubmitting || activeJob || jobLoading}
      aria-describedby={descriptionId}
      onClick={onRefresh}
    >
      <RefreshCw className={jobSubmitting || activeJob ? "daily-airing-spin" : ""} aria-hidden="true" />
      {jobSubmitting
        ? t("calendar.submitting")
        : activeJob
          ? t("calendar.refreshing")
          : jobFailed
            ? t("calendar.retryRefresh")
            : t(mobile ? "calendar.refreshMobile" : "calendar.refresh")}
    </Button>
  );
}

function MobileAiringSchedule({
  calendar,
  locale,
  selectedDayIndex,
  onSelectDay,
}: {
  calendar: AiringCalendarResponse;
  locale: string;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
}) {
  const t = useTranslations();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedDay = calendar.days[selectedDayIndex] ?? calendar.days[0];

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = Math.min(calendar.days.length - 1, index + 1);
    else if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = calendar.days.length - 1;
    else return;
    event.preventDefault();
    onSelectDay(nextIndex);
    const tab = tabRefs.current[nextIndex];
    tab?.focus();
    tab?.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  if (!selectedDay) return null;
  const selectedDateLabel = formatFullDate(selectedDay.date, locale);
  return (
    <div className="mobile-airing-content">
      <div className="mobile-airing-picker-wrap">
        <div className="mobile-airing-picker" role="tablist" aria-label={t("calendar.selectDate")}>
          {calendar.days.map((day, index) => {
            const selected = index === selectedDayIndex;
            return (
              <button
                key={day.date}
                ref={(node) => { tabRefs.current[index] = node; }}
                id={`mobile-airing-tab-${day.date}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="mobile-airing-panel"
                aria-label={t("calendar.dayTabLabel", {
                  date: formatFullDate(day.date, locale),
                  count: day.items.length,
                })}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectDay(index)}
                onKeyDown={(event) => selectFromKeyboard(event, index)}
              >
                <span>{formatShortWeekday(day.date, locale)}</span>
                <strong>{formatDayNumber(day.date)}</strong>
              </button>
            );
          })}
        </div>
      </div>
      <section
        id="mobile-airing-panel"
        role="tabpanel"
        aria-labelledby={`mobile-airing-tab-${selectedDay.date}`}
        className="mobile-airing-panel"
      >
        <header className="mobile-airing-day-header">
          <div>
            <span className="mobile-airing-relative-day" data-current={selectedDayIndex === 0}>
              {selectedDayIndex === 0 ? t("calendar.today") : selectedDayIndex === 1 ? t("calendar.tomorrow") : t("calendar.daysLater", { count: selectedDayIndex })}
            </span>
            <h2>{formatMobileDate(selectedDay.date, locale)}</h2>
          </div>
          <strong>{t("calendar.animeCount", { count: selectedDay.items.length })}</strong>
        </header>
        {selectedDay.items.length > 0 ? (
          <div className="mobile-airing-list">
            {selectedDay.items.map((item) => (
              <MobileAiringAnimeCard
                key={item.anime.id}
                item={item}
                dateLabel={selectedDateLabel}
                timeZone={calendar.timeZone}
              />
            ))}
          </div>
        ) : <DayEmpty />}
      </section>
    </div>
  );
}

function DesktopAiringBrowser({ calendar, locale, selectedDate, onSelectDate }: {
  calendar: AiringCalendarResponse;
  locale: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const t = useTranslations();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, calendar.days.findIndex((day) => day.date === selectedDate));
  const selectedDay = calendar.days[selectedIndex] ?? calendar.days[0];

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = Math.min(calendar.days.length - 1, index + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = calendar.days.length - 1;
    else return;
    event.preventDefault();
    onSelectDate(calendar.days[nextIndex].date);
    tabRefs.current[nextIndex]?.focus();
  }

  if (!selectedDay) return null;
  const selectedDateLabel = formatFullDate(selectedDay.date, locale);
  const selectedRelativeLabel = selectedIndex === 0
    ? t("calendar.today")
    : selectedIndex === 1
      ? t("calendar.tomorrow")
      : t("calendar.daysLater", { count: selectedIndex });
  return (
    <div className="desktop-airing-browser">
      <nav className="desktop-airing-date-nav" aria-label={t("calendar.selectDate")}>
        <div className="desktop-airing-date-tabs" role="tablist">
          {calendar.days.map((day, index) => {
            const selected = day.date === selectedDay.date;
            const relativeLabel = index === 0
              ? t("calendar.today")
              : index === 1
                ? t("calendar.tomorrow")
                : t("calendar.daysLater", { count: index });
            return (
              <button
                key={day.date}
                ref={(node) => { tabRefs.current[index] = node; }}
                id={`desktop-airing-tab-${day.date}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="desktop-airing-panel"
                aria-label={t("calendar.dayTabLabel", {
                  date: formatFullDate(day.date, locale),
                  count: day.items.length,
                })}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectDate(day.date)}
                onKeyDown={(event) => selectFromKeyboard(event, index)}
              >
                <span className="desktop-airing-date-copy">
                  <strong>{relativeLabel}</strong>
                  <span>{formatDesktopNavDate(day.date, locale)} · {formatWeekday(day.date, locale)}</span>
                </span>
                <span className="desktop-airing-date-count">{day.items.length}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <section
        id="desktop-airing-panel"
        role="tabpanel"
        aria-labelledby={`desktop-airing-tab-${selectedDay.date}`}
        className="desktop-airing-panel"
      >
        <header className="desktop-airing-panel-header">
          <div className="desktop-airing-panel-identity">
            <strong data-current={selectedIndex === 0}>{selectedRelativeLabel}</strong>
            <div>
              <time dateTime={selectedDay.date}>{formatScheduleDate(selectedDay.date, locale)}</time>
              <span>{formatWeekday(selectedDay.date, locale)}</span>
            </div>
          </div>
          <span>{t("calendar.animeCount", { count: selectedDay.items.length })}</span>
        </header>
        {selectedDay.items.length > 0 ? (
          <ol className="desktop-airing-panel-list">
            {selectedDay.items.map((item) => (
              <li key={item.anime.id}>
                <AiringAnimeCard item={item} dateLabel={selectedDateLabel} timeZone={calendar.timeZone} />
              </li>
            ))}
          </ol>
        ) : <DayEmpty />}
      </section>
    </div>
  );
}

function CalendarSkeleton({ mobile }: { mobile: boolean }) {
  if (mobile) {
    return (
      <div className="mobile-airing-skeleton" aria-hidden="true">
        <div className="mobile-airing-skeleton-tabs" />
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="mobile-airing-skeleton-card" />)}
      </div>
    );
  }
  return (
    <div className="daily-airing-skeleton" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index}><span /><i /><i /></div>
      ))}
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations();
  return (
    <div className="daily-airing-state app-content-card" role="alert">
      <AlertCircle aria-hidden="true" />
      <h2>{t("calendar.loadFailed")}</h2>
      <Button type="button" variant="outline" onClick={onRetry}>{t("calendar.retry")}</Button>
    </div>
  );
}

function EmptyCalendar() {
  const t = useTranslations();
  return (
    <div className="daily-airing-state app-content-card">
      <h2>{t("calendar.emptyTitle")}</h2>
      <p>{t("calendar.emptyDescription")}</p>
      <div><Link href="/library">{t("calendar.browseLibrary")}</Link><Link href="/search">{t("calendar.searchAnime")}</Link></div>
    </div>
  );
}

function DayEmpty() {
  const t = useTranslations();
  return <p className="daily-airing-day-empty">{t("calendar.noReleasesDay")}</p>;
}

function parseDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function formatFullDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC" }).format(parseDate(date));
}

function formatScheduleDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDate(date));
}

function formatWeekday(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(parseDate(date));
}

function formatShortWeekday(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "narrow",
    timeZone: "UTC",
  }).format(parseDate(date));
}

function formatDesktopNavDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDate(date));
}

function formatDayNumber(date: string) {
  return String(parseDate(date).getUTCDate());
}

function formatMobileDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDate(date));
}

function formatRange(start: string, end: string, locale: string) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const crossesYear = startDate.getUTCFullYear() !== endDate.getUTCFullYear();
  const formatter = new Intl.DateTimeFormat(locale, {
    ...(crossesYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function localDateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
