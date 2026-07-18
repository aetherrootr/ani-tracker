"use client";

import { ChevronLeft, ChevronRight, RefreshCw, Table2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModalSurface } from "@/components/ui/modal-surface";
import { SegmentedControl } from "@/components/ui/sliding-option-group";
import { useCurrentUser } from "@/features/auth/hooks";
import { assetUrl } from "@/features/library/api";
import { useStatisticsSummary, useWatchTimeline } from "@/features/statistics/hooks";
import type { StatisticsDay, StatisticsSummary, StatisticsWeek, WatchTimelineItem } from "@/features/statistics/types";
import { useLocaleControls } from "@/i18n/provider";
import { cn } from "@/lib/utils";

type ChartKind = "daily" | "weekly";

export function StatisticsPageContent() {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const { user } = useCurrentUser();
  const summary = useStatisticsSummary(user?.weekStartDay, user?.includeUnwatchedSeasonZeroInStatistics, user?.timeZone);
  const timeline = useWatchTimeline(user?.timeZone);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const touchLayout = useTouchChartLayout();
  const [chartKind, setChartKind] = useState<ChartKind>("daily");

  async function handleRecalculate() {
    setRefreshMessage(null);
    try {
      await summary.recalculate();
      timeline.refresh();
      setRefreshMessage(t("statistics.refreshSuccess"));
    } catch {
      setRefreshMessage(t("statistics.refreshFailed"));
    }
  }

  const data = summary.displayData;
  const pending = summary.isRefreshing || summary.data?.status === "pending";
  return (
    <main className="statistics-content-floor mx-auto max-w-[1280px] select-none space-y-5 overflow-visible rounded-3xl border p-4 shadow-sm sm:p-6" aria-busy={pending || summary.isLoading}>
      <header className="page-heading-surface flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between sm:gap-8">
        <div>
          <p className="hidden text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground sm:block">{t("statistics.eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:mt-2">{t("statistics.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("statistics.description")}</p>
          {data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("statistics.updatedAt", { time: formatDateTime(data.calculatedAt, locale, data.timeZone), timeZone: data.timeZone })}
            </p>
          ) : null}
        </div>
        <Button
          className="min-h-11 self-start px-6 text-[15px] sm:self-center"
          style={pending ? { opacity: 1, borderColor: "var(--border-neutral)", background: "var(--card)", color: "var(--text-tertiary)", boxShadow: "none" } : undefined}
          variant="outline"
          onClick={handleRecalculate}
          disabled={pending}
        >
          <RefreshCw className={cn("h-[18px] w-[18px]", pending && "animate-spin motion-reduce:animate-none")} />
          {pending ? t("statistics.refreshing") : t("statistics.refresh")}
        </Button>
      </header>

      <div className="sr-only" role="status" aria-live="polite">{refreshMessage}</div>
      {pending && data ? <p role="status" className="rounded-xl border bg-[var(--surface-card)] px-4 py-3 text-sm text-muted-foreground">{t("statistics.pending")}</p> : null}
      {(summary.error || summary.data?.status === "failed") ? (
        <InlineError message={data ? t("statistics.refreshFailedRetained") : t("statistics.loadFailed")} onRetry={summary.retry} />
      ) : null}

      {data ? (
        <StatisticsSection title={t("statistics.groups.overview")}>
          <StatisticsOverview data={data} locale={locale} />
        </StatisticsSection>
      ) : <OverviewSkeleton loading={summary.isLoading} />}

      {data ? (
        <StatisticsSection title={t("statistics.groups.trends")}>
          {data.watchedEpisodeCount === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t("statistics.emptyTrends")}</CardContent></Card>
          ) : (
            <>
              {touchLayout ? (
                <SegmentedControl
                  fullWidth
                  value={chartKind}
                  onValueChange={setChartKind}
                  ariaLabel={t("statistics.chartSwitcher.label")}
                  optionClassName="min-h-11"
                  options={[
                    { value: "daily", label: t("statistics.chartSwitcher.daily") },
                    { value: "weekly", label: t("statistics.chartSwitcher.weekly") },
                  ]}
                />
              ) : null}
              <div className="grid min-w-0 gap-4">
                {(!touchLayout || chartKind === "daily") ? (
                  <DailyHeatmap days={data.daily} locale={locale} touchLayout={touchLayout} />
                ) : null}
                {(!touchLayout || chartKind === "weekly") ? (
                  <WeeklyWatchTime weeks={data.weekly} locale={locale} touchLayout={touchLayout} />
                ) : null}
              </div>
            </>
          )}
        </StatisticsSection>
      ) : null}

      <StatisticsSection title={t("statistics.groups.timeline")}>
        <WatchTimelineSection timeline={timeline} locale={locale} timeZone={timeline.timeZone || user?.timeZone || "UTC"} />
      </StatisticsSection>
    </main>
  );
}

function StatisticsSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3"><h2 className="section-heading-surface text-xl font-semibold tracking-tight">{title}</h2>{children}</section>;
}

function StatisticsOverview({ data, locale }: { data: StatisticsSummary; locale: string }) {
  const t = useTranslations();
  const number = new Intl.NumberFormat(locale);
  const cards = [
    { label: t("statistics.metrics.watchedEpisodes"), value: number.format(data.watchedEpisodeCount), unit: t("statistics.units.episodes") },
    { label: t("statistics.metrics.unwatchedAired"), value: number.format(data.unwatchedAiredEpisodeCount), unit: t("statistics.units.episodes") },
    {
      label: t("statistics.metrics.totalWatchTime"),
      value: formatDuration(data.totalWatchSeconds, t, true),
      mobileValue: formatLargeDuration(data.totalWatchSeconds, t, locale),
      accessibleValue: formatDuration(data.totalWatchSeconds, t),
      unit: "",
    },
    { label: t("statistics.metrics.libraryAnime"), value: number.format(data.libraryAnimeCount), unit: t("statistics.units.anime") },
  ];
  return (
    <Card className="overflow-hidden">
      <CardContent className="grid grid-cols-2 gap-px overflow-hidden p-0 max-[340px]:grid-cols-1 lg:grid-cols-4">
        {cards.map((card, index) => (
          <div key={card.label} className={cn("min-w-0 bg-[var(--surface-card)] p-4", index > 0 && "border-l max-[340px]:border-l-0 max-[340px]:border-t", index > 1 && "border-t lg:border-t-0")}>
            <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
            <p className="mt-2 flex flex-wrap items-baseline gap-1.5">
              <span className="min-w-0 break-words text-[clamp(1.25rem,6vw,1.5rem)] font-semibold leading-tight tracking-tight sm:text-2xl" title={card.accessibleValue} aria-label={card.accessibleValue}>
                {card.mobileValue ? <><span className="sm:hidden">{card.mobileValue}</span><span className="hidden sm:inline">{card.value}</span></> : card.value}
              </span>
              {card.unit ? <span className="text-xs text-muted-foreground">{card.unit}</span> : null}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function OverviewSkeleton({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div role="status" aria-label="Loading statistics" className="grid grid-cols-2 gap-3 max-[340px]:grid-cols-1 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => <div key={index} aria-hidden="true" className="h-24 animate-pulse rounded-[18px] border bg-muted motion-reduce:animate-none" />)}
    </div>
  );
}

function DailyHeatmap({ days, locale, touchLayout }: { days: StatisticsDay[]; locale: string; touchLayout: boolean }) {
  const t = useTranslations();
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [rangeOffset, setRangeOffset] = useState(0);
  const visibleWeekCount = touchLayout ? 1 : Math.min(53, Math.max(13, Math.floor((width || 850) / 18)));
  const endIndex = Math.max(0, days.length - rangeOffset * 7);
  const visibleDays = days.slice(Math.max(0, endIndex - visibleWeekCount * 7), endIndex);
  const [selectedDate, setSelectedDate] = useState(days.at(-1)?.date ?? "");
  const [focusedDate, setFocusedDate] = useState(days.at(-1)?.date ?? "");
  const activeDay = days.find((day) => day.date === selectedDate) ?? days.at(-1);
  const effectiveFocusedDate = visibleDays.some((day) => day.date === focusedDate) ? focusedDate : visibleDays.at(-1)?.date;
  const focusIndex = Math.max(0, visibleDays.findIndex((day) => day.date === effectiveFocusedDate));

  function moveFocus(index: number) {
    const next = visibleDays[Math.max(0, Math.min(visibleDays.length - 1, index))];
    if (!next) return;
    setFocusedDate(next.date);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-heatmap-date="${next.date}"]`)?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - 7, ArrowDown: index + 7, Home: 0, End: visibleDays.length - 1, PageUp: index - 28, PageDown: index + 28 };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const day = visibleDays[index];
      if (day) setSelectedDate(day.date);
    }
  }

  const latestRange = rangeOffset === 0;
  const canGoOlder = endIndex - visibleWeekCount * 7 > 0;
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle>{t("statistics.daily.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{dailySummary(days, locale, t)}</p>
      </CardHeader>
      <CardContent>
        <YearOverview days={days} locale={locale} showMiniHeatmap={touchLayout} />
        <SelectedDay day={activeDay} locale={locale} />
        {touchLayout ? (
          <ChartRangeControls
            label={formatDateRange(visibleDays[0]?.date, visibleDays.at(-1)?.date, locale)}
            previousDisabled={!canGoOlder}
            nextDisabled={latestRange}
            onPrevious={() => setRangeOffset((value) => value + 1)}
            onNext={() => setRangeOffset((value) => Math.max(0, value - 1))}
          />
        ) : <p className="mt-3 text-center text-xs font-medium text-muted-foreground">{formatDateRange(visibleDays[0]?.date, visibleDays.at(-1)?.date, locale)}</p>}
        <div ref={containerRef} className="mt-3 min-w-0">
          <div role="grid" aria-label={t("statistics.daily.gridLabel", { count: visibleDays.length })} className={cn("grid gap-1", touchLayout ? "grid-cols-7" : "grid-flow-col grid-rows-7")}>
            {visibleDays.map((day, index) => {
              const label = t("statistics.daily.tooltip", { date: formatDate(day.date, locale), count: day.watchedEpisodeCount, duration: formatDuration(day.watchSeconds, t) });
              const selected = day.date === activeDay?.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  role="gridcell"
                  data-heatmap-date={day.date}
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-label={`${label}. ${index + 1}/${visibleDays.length}`}
                  aria-selected={selected}
                  onFocus={() => setFocusedDate(day.date)}
                  onClick={() => { setFocusedDate(day.date); setSelectedDate(day.date); }}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={cn(
                    "relative rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    touchLayout ? "min-h-11 min-w-0" : "aspect-square min-w-3",
                    selected && "ring-2 ring-ring ring-offset-1",
                    heatmapClass(day.watchedEpisodeCount),
                  )}
                ><span className={cn("text-[10px] font-semibold", touchLayout ? "inline" : "sr-only")}>{new Date(`${day.date}T12:00:00Z`).getUTCDate()}</span></button>
              );
            })}
          </div>
        </div>
        <HeatmapLegend />
        <StatisticsTable title={t("statistics.daily.tableTitle")} headers={[t("statistics.table.date"), t("statistics.table.episodes"), t("statistics.table.duration")]}
          rows={visibleDays.map((day) => [formatDate(day.date, locale), String(day.watchedEpisodeCount), formatDuration(day.watchSeconds, t)])} />
      </CardContent>
    </Card>
  );
}

function YearOverview({ days, locale, showMiniHeatmap }: { days: StatisticsDay[]; locale: string; showMiniHeatmap: boolean }) {
  const t = useTranslations();
  const activeDays = days.filter((day) => day.watchedEpisodeCount > 0).length;
  const episodeCount = days.reduce((sum, day) => sum + day.watchedEpisodeCount, 0);
  const watchSeconds = days.reduce((sum, day) => sum + day.watchSeconds, 0);
  const weekCount = Math.ceil(days.length / 7);
  const summary = t("statistics.daily.yearOverviewLabel", {
    weeks: weekCount,
    activeDays,
    episodes: episodeCount,
    duration: formatDuration(watchSeconds, t),
  });
  return (
    <section className="mb-4 rounded-2xl border bg-background/50 p-4" aria-labelledby="year-overview-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="year-overview-title" className="text-sm font-semibold">{t("statistics.daily.yearOverview")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateRange(days[0]?.date, days.at(-1)?.date, locale)}</p>
        </div>
        <span className="text-xs font-medium text-[var(--watched)]">{t("statistics.daily.weeks", { count: weekCount })}</span>
      </div>
      {!showMiniHeatmap ? <p className="sr-only">{summary}</p> : null}
      {showMiniHeatmap ? (
        <div role="img" aria-label={summary} className="mt-4 grid grid-flow-col grid-rows-7 gap-[2px]" style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }}>
          {days.map((day) => <span key={day.date} aria-hidden="true" className={cn("aspect-square min-w-0 rounded-[2px] border border-black/5 dark:border-white/5", heatmapClass(day.watchedEpisodeCount))} />)}
        </div>
      ) : null}
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
        <div className="min-w-0"><dt className="text-[11px] leading-4 text-muted-foreground">{t("statistics.daily.activeDays")}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{new Intl.NumberFormat(locale).format(activeDays)}</dd></div>
        <div className="min-w-0 border-x px-1"><dt className="text-[11px] leading-4 text-muted-foreground">{t("statistics.daily.yearEpisodes")}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{new Intl.NumberFormat(locale).format(episodeCount)}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] leading-4 text-muted-foreground">{t("statistics.daily.yearDuration")}</dt><dd className="mt-1 break-words text-sm font-semibold">{formatDuration(watchSeconds, t, true)}</dd></div>
      </dl>
    </section>
  );
}

function SelectedDay({ day, locale }: { day: StatisticsDay | undefined; locale: string }) {
  const t = useTranslations();
  return <div className="min-h-[62px] rounded-xl border bg-background/50 p-3 text-sm">{day ? <><p className="font-medium">{formatDate(day.date, locale)}</p><p className="mt-1 text-muted-foreground">{t("statistics.daily.tooltip", { date: "", count: day.watchedEpisodeCount, duration: formatDuration(day.watchSeconds, t) }).replace(/^[:：]\s*/, "")}</p></> : null}</div>;
}

function HeatmapLegend() {
  const t = useTranslations();
  const labels = ["0", "1-2", "3-5", "6-9", "10+"];
  return <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label={t("statistics.daily.legendLabel")}>
    {labels.map((label, level) => <span key={label} className="inline-flex items-center gap-1"><span aria-hidden="true" className={cn("h-4 w-4 rounded border", heatmapLevelClass(level))} /><span>{label}</span></span>)}
  </div>;
}

function WeeklyWatchTime({ weeks, locale, touchLayout }: { weeks: StatisticsWeek[]; locale: string; touchLayout: boolean }) {
  const t = useTranslations();
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>();
  const [rangeOffset, setRangeOffset] = useState(0);
  const count = touchLayout ? 5 : weeks.length;
  const end = Math.max(0, weeks.length - rangeOffset * count);
  const visibleWeeks = weeks.slice(Math.max(0, end - count), end);
  const [selectedKey, setSelectedKey] = useState(weeks.at(-1)?.weekStartDate ?? "");
  const [focusedKey, setFocusedKey] = useState(weeks.at(-1)?.weekStartDate ?? "");
  const currentWeek = weeks.at(-1);
  const activeWeek = weeks.find((week) => week.weekStartDate === selectedKey) ?? weeks.at(-1);
  const maxSeconds = Math.max(1, ...visibleWeeks.map((week) => week.watchSeconds));
  const axisMax = niceAxisMaximum(maxSeconds);
  const focusedIndex = Math.max(0, visibleWeeks.findIndex((week) => week.weekStartDate === focusedKey));

  function moveFocus(index: number) {
    const next = visibleWeeks[Math.max(0, Math.min(visibleWeeks.length - 1, index))];
    if (!next) return;
    setFocusedKey(next.weekStartDate);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-week="${next.weekStartDate}"]`)?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      moveFocus(event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : event.key === "Home" ? 0 : visibleWeeks.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const week = visibleWeeks[index];
      if (week) setSelectedKey(week.weekStartDate);
    }
  }

  const points = visibleWeeks.map((week, index) => ({
    week,
    x: visibleWeeks.length === 1 ? 53 : 8 + index / (visibleWeeks.length - 1) * 90,
    y: 10 + (1 - week.watchSeconds / axisMax) * 68,
  }));
  const selectedPoint = points.find((point) => point.week.weekStartDate === activeWeek?.weekStartDate);
  const showEveryLabel = touchLayout || chartWidth >= 900 ? 1 : 2;
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = points.length > 1 ? `${points[0]?.x},78 ${linePoints} ${points.at(-1)?.x},78` : "";
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3"><CardTitle>{t("statistics.weekly.title")}</CardTitle><p className="text-sm text-muted-foreground">{weeklySummary(visibleWeeks, t)}</p></CardHeader>
      <CardContent>
        {currentWeek ? (
          <div className="mb-3 flex flex-col gap-3 rounded-xl border bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--watched)]">{t("statistics.weekly.currentWeek")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateRange(currentWeek.weekStartDate, currentWeek.weekEndDate, locale)}</p>
            </div>
            <dl className="grid grid-cols-2 gap-5 sm:text-right">
              <div>
                <dt className="text-xs text-muted-foreground">{t("statistics.weekly.currentWeekDuration")}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight">{formatDuration(currentWeek.watchSeconds, t, true)}</dd>
              </div>
              <div className="border-l pl-5">
                <dt className="text-xs text-muted-foreground">{t("statistics.weekly.currentWeekEpisodes")}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{new Intl.NumberFormat(locale).format(currentWeek.watchedEpisodeCount)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
        <div className="min-h-[62px] rounded-xl border bg-background/50 p-3 text-sm">
          {activeWeek ? <><p className="font-medium">{formatDateRange(activeWeek.weekStartDate, activeWeek.weekEndDate, locale)}</p><p className="mt-1 text-muted-foreground">{t("statistics.weekly.episodes", { count: activeWeek.watchedEpisodeCount })} · {formatDuration(activeWeek.watchSeconds, t)}</p></> : null}
        </div>
        {touchLayout ? (
          <ChartRangeControls label={formatDateRange(visibleWeeks[0]?.weekStartDate, visibleWeeks.at(-1)?.weekEndDate, locale)} previousDisabled={end - count <= 0} nextDisabled={rangeOffset === 0} onPrevious={() => setRangeOffset((value) => value + 1)} onNext={() => setRangeOffset((value) => Math.max(0, value - 1))} />
        ) : <p className="mt-3 text-center text-xs font-medium text-muted-foreground">{formatDateRange(visibleWeeks[0]?.weekStartDate, visibleWeeks.at(-1)?.weekEndDate, locale)}</p>}
        <div ref={chartRef} className={cn("relative mt-2 min-w-0", touchLayout ? "h-[240px]" : "h-[300px]")} role="radiogroup" aria-label={t("statistics.weekly.chartLabel", { count: visibleWeeks.length })}>
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="weekly-watch-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--watched)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--watched)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[10, 44, 78].map((y) => <line key={y} x1="8" x2="98" y1={y} y2={y} stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />)}
            {areaPoints ? <polygon points={areaPoints} fill="url(#weekly-watch-area)" /> : null}
            {selectedPoint ? <line x1={selectedPoint.x} x2={selectedPoint.x} y1="10" y2="78" stroke="var(--accent-solid)" strokeDasharray="2 4" opacity="0.5" vectorEffect="non-scaling-stroke" /> : null}
            {points.length > 1 ? <polyline points={linePoints} fill="none" stroke="var(--watched)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          <span className="absolute left-0 top-[6%] text-[11px] tabular-nums text-muted-foreground">{formatDuration(axisMax, t, true)}</span>
          <span className="absolute left-0 top-[40%] text-[11px] tabular-nums text-muted-foreground">{formatDuration(Math.round(axisMax / 2), t, true)}</span>
          <span className="absolute left-0 top-[74%] text-[11px] tabular-nums text-muted-foreground">0</span>
          {points.map((point, index) => {
            const selected = point.week.weekStartDate === activeWeek?.weekStartDate;
            return <span key={point.week.weekStartDate}>
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute z-[1] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--surface-card)]",
                  selected ? "h-5 w-5 border-2 border-[var(--accent-solid)]" : "h-3 w-3 border-[3px] border-[var(--watched)]",
                )}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {selected ? <span className="h-2 w-2 rounded-full bg-[var(--watched)]" /> : null}
              </span>
              <button
                type="button"
                role="radio"
                data-week={point.week.weekStartDate}
                tabIndex={index === focusedIndex ? 0 : -1}
                aria-checked={selected}
                aria-label={t("statistics.weekly.tooltip", { start: formatDate(point.week.weekStartDate, locale), end: formatDate(point.week.weekEndDate, locale), count: point.week.watchedEpisodeCount, duration: formatDuration(point.week.watchSeconds, t) })}
                onFocus={() => setFocusedKey(point.week.weekStartDate)}
                onClick={() => { setFocusedKey(point.week.weekStartDate); setSelectedKey(point.week.weekStartDate); }}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={cn("absolute z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", touchLayout ? "h-11 w-11" : "h-7 w-7")}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              ><span className="sr-only">{formatDate(point.week.weekStartDate, locale)}</span></button>
              {(index % showEveryLabel === 0 || index === points.length - 1) ? <span aria-hidden="true" className="absolute top-[84%] -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground" style={{ left: `${point.x}%` }}>{formatShortDate(point.week.weekStartDate, locale)}</span> : null}
            </span>;
          })}
        </div>
        <StatisticsTable title={t("statistics.weekly.tableTitle")} headers={[t("statistics.table.range"), t("statistics.table.episodes"), t("statistics.table.duration")]}
          rows={visibleWeeks.map((week) => [formatDateRange(week.weekStartDate, week.weekEndDate, locale), String(week.watchedEpisodeCount), formatDuration(week.watchSeconds, t)])} />
      </CardContent>
    </Card>
  );
}

function ChartRangeControls({ label, previousDisabled, nextDisabled, onPrevious, onNext }: { label: string; previousDisabled: boolean; nextDisabled: boolean; onPrevious: () => void; onNext: () => void }) {
  const t = useTranslations();
  return <div className="mt-3 flex items-center justify-between gap-2">
    <Button type="button" size="icon" variant="outline" className="min-h-11 min-w-11" disabled={previousDisabled} onClick={onPrevious} aria-label={t("statistics.range.previous")}><ChevronLeft className="h-4 w-4" /></Button>
    <p className="min-w-0 text-center text-xs font-medium text-muted-foreground">{label}</p>
    <Button type="button" size="icon" variant="outline" className="min-h-11 min-w-11" disabled={nextDisabled} onClick={onNext} aria-label={t("statistics.range.next")}><ChevronRight className="h-4 w-4" /></Button>
  </div>;
}

function StatisticsTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return <>
    <div className="mt-4 border-t pt-3">
      <Button type="button" variant="ghost" className="min-h-11 w-full justify-start px-2 text-primary" onClick={() => setOpen(true)}>
        <Table2 className="mr-2 h-4 w-4" />
        {title}
      </Button>
    </div>
    <ModalSurface
      open={open}
      titleId={titleId}
      panelClassName="h-[100svh] select-none pt-[env(safe-area-inset-top)] sm:h-auto sm:max-h-[82svh] sm:max-w-4xl sm:rounded-[var(--radius-modal)] sm:pt-0"
      onClose={() => setOpen(false)}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b bg-[var(--surface-glass-strong)] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lg font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("statistics.table.rowCount", { count: rows.length })}</p>
        </div>
        <Button data-dialog-close type="button" size="icon" variant="ghost" className="min-h-11 min-w-11 shrink-0" onClick={() => setOpen(false)} aria-label={t("statistics.table.close")}>
          <X className="h-5 w-5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
        <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--surface-card)]">
            <tr>{headers.map((header) => <th key={header} scope="col" className="border-b px-3 py-3 font-semibold">{header}</th>)}</tr>
          </thead>
          <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((value, index) => <td key={`${row[0]}-${index}`} className="border-b px-3 py-3 text-muted-foreground">{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </ModalSurface>
  </>;
}

function WatchTimelineSection({ timeline, locale, timeZone }: { timeline: ReturnType<typeof useWatchTimeline>; locale: string; timeZone: string }) {
  const t = useTranslations();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMore = timeline.loadMore;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "160px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const groups = groupTimeline(timeline.items);
  return <Card aria-busy={timeline.isLoading || timeline.isLoadingMore}>
    <CardHeader>
      <CardTitle>{t("statistics.timeline.title")}</CardTitle>
      {timeline.items.length > 0 ? <p className="text-sm text-muted-foreground">{t("statistics.timeline.orderLabel")}</p> : null}
    </CardHeader>
    <CardContent>
      {timeline.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t("statistics.timeline.loading")}</p> : null}
      {!timeline.isLoading && timeline.items.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("statistics.timeline.empty")}</p> : null}
      <div aria-label={t("statistics.timeline.title")}>
        {groups.map(([date, items]) => <section key={date} aria-labelledby={`timeline-${date}`} className="mx-auto mt-5 max-w-5xl first:mt-0">
          <h3 id={`timeline-${date}`} className="flex items-center gap-3 py-2 text-sm font-semibold"><span className="h-px flex-1 bg-border" /><time dateTime={date}>{formatDate(date, locale)}</time><span className="h-px flex-1 bg-border" /></h3>
          <ol>{items.map((item, index) => (
            <li key={`${item.episode.source}-${item.episode.id}-${item.episode.watchedAt}`} className="relative pb-2 last:pb-0 sm:grid sm:grid-cols-[7.5rem_1.5rem_minmax(0,1fr)] sm:gap-3">
              <div className="hidden justify-end pt-4 text-right sm:flex">
                <time dateTime={item.episode.watchedAt ?? undefined} className="text-sm font-medium tabular-nums text-muted-foreground">{formatTimeOnly(item.episode.watchedAt, locale, timeZone)}</time>
              </div>
              <div aria-hidden="true" className="relative hidden justify-center sm:flex">
                {index > 0 ? <span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-border" /> : null}
                {index < items.length - 1 ? <span className="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-border" /> : null}
                <span className="relative z-[1] mt-5 h-2.5 w-2.5 rounded-full border-2 border-[var(--watched)] bg-[var(--surface-card)]" />
              </div>
              <TimelineItem item={item} locale={locale} timeZone={timeZone} />
            </li>
          ))}</ol>
        </section>)}
      </div>
      {timeline.error ? <InlineError className="mt-4" message={t("statistics.timeline.loadFailed")} onRetry={timeline.items.length ? timeline.loadMore : timeline.retry} /> : null}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      {timeline.hasMore ? <Button className="mt-4 min-h-11 w-full" variant="outline" disabled={timeline.isLoadingMore} onClick={timeline.loadMore}>{timeline.isLoadingMore ? t("statistics.timeline.loadingMore") : t("statistics.timeline.loadMore", { loaded: timeline.items.length, total: timeline.total })}</Button> : null}
      {!timeline.isLoading && !timeline.hasMore && timeline.items.length > 0 ? <p role="status" className="mt-4 text-center text-sm text-muted-foreground">{t("statistics.timeline.noMore")}</p> : null}
    </CardContent>
  </Card>;
}

function TimelineItem({ item, locale, timeZone }: { item: WatchTimelineItem; locale: string; timeZone: string }) {
  const t = useTranslations();
  const poster = assetUrl(item.anime.posterUrl);
  const href = `/library/${item.anime.id}?episode=${item.episode.episodeNumber}#episode-${item.episode.id}`;
  const watchedAt = formatDateTime(item.episode.watchedAt, locale, timeZone);
  const episodeName = `${t("statistics.timeline.episode", { episode: item.episode.episodeNumber })}${item.episode.displayName ? ` · ${item.episode.displayName}` : ""}`;
  return <article className="rounded-xl border bg-background/50">
    <Link href={href} className="flex min-h-[96px] gap-3 rounded-xl p-3 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`${item.anime.displayName}, ${episodeName}, ${watchedAt}`}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-20 w-14 shrink-0 rounded-lg object-cover" />
      ) : <div aria-hidden="true" className="h-20 w-14 shrink-0 rounded-lg bg-muted" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-sm font-medium">{item.anime.displayName}</span>
        <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{episodeName}</span>
        <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2 text-xs text-muted-foreground"><time className="sm:hidden" dateTime={item.episode.watchedAt ?? undefined}>{watchedAt}</time>{item.episode.durationSeconds !== null ? <span>{formatDuration(item.episode.durationSeconds, t)}</span> : null}</span>
      </span>
    </Link>
  </article>;
}

function InlineError({ message, onRetry, className }: { message: string; onRetry: () => void | Promise<void>; className?: string }) {
  const t = useTranslations();
  return <div role="alert" className={cn("flex flex-col gap-3 rounded-xl border border-destructive/40 bg-[var(--surface-card)] p-4 sm:flex-row sm:items-center sm:justify-between", className)}><p className="text-sm text-destructive">{message}</p><Button variant="outline" onClick={() => void onRetry()}>{t("statistics.retry")}</Button></div>;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useTouchChartLayout() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px), (hover: none), (pointer: coarse), (max-height: 500px) and (hover: none)");
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return touch;
}

function groupTimeline(items: WatchTimelineItem[]) {
  const groups = new Map<string, WatchTimelineItem[]>();
  for (const item of items) {
    const group = groups.get(item.episode.localDate) ?? [];
    group.push(item);
    groups.set(item.episode.localDate, group);
  }
  return [...groups.entries()];
}

function heatmapClass(count: number) {
  return heatmapLevelClass(count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4);
}

function heatmapLevelClass(level: number) {
  return ["bg-muted", "bg-emerald-200 dark:bg-emerald-950", "bg-emerald-300 dark:bg-emerald-800", "bg-emerald-500 dark:bg-emerald-600", "bg-emerald-700 dark:bg-emerald-400"][level];
}

function formatDuration(seconds: number, t: ReturnType<typeof useTranslations>, compact = false) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (compact && hours > 0) return t("statistics.duration.compactHoursMinutes", { hours, minutes });
  if (hours > 0) return t("statistics.duration.hoursMinutesSeconds", { hours, minutes, seconds: rest });
  if (minutes > 0) return t("statistics.duration.minutesSeconds", { minutes, seconds: rest });
  return t("statistics.duration.seconds", { seconds: rest });
}

function formatLargeDuration(seconds: number, t: ReturnType<typeof useTranslations>, locale: string) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours < 1000) return formatDuration(seconds, t, true);
  const compactHours = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(hours);
  return t("statistics.duration.compactLargeHoursMinutes", { hours: compactHours, minutes });
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatShortDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatDateRange(start: string | undefined, end: string | undefined, locale: string) {
  if (!start || !end) return "";
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  return typeof formatter.formatRange === "function" ? formatter.formatRange(first, last) : `${formatter.format(first)} - ${formatter.format(last)}`;
}

function formatDateTime(value: string | null, locale: string, timeZone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

function formatTimeOnly(value: string | null, locale: string, timeZone: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(new Date(value));
}

function dailySummary(days: StatisticsDay[], locale: string, t: ReturnType<typeof useTranslations>) {
  const last = [...days].reverse().find((day) => day.watchedEpisodeCount > 0);
  return last ? t("statistics.daily.summary", { date: formatDate(last.date, locale), count: last.watchedEpisodeCount }) : t("statistics.insufficientTrend");
}

function weeklySummary(weeks: StatisticsWeek[], t: ReturnType<typeof useTranslations>) {
  if (weeks.length < 2) return t("statistics.insufficientTrend");
  const latest = weeks.at(-1)?.watchSeconds ?? 0;
  const average = weeks.reduce((sum, week) => sum + week.watchSeconds, 0) / weeks.length;
  return t(latest >= average ? "statistics.weekly.aboveAverage" : "statistics.weekly.belowAverage");
}

function niceAxisMaximum(seconds: number) {
  if (seconds >= 3600) return Math.ceil(seconds / 3600) * 3600;
  if (seconds >= 60) return Math.ceil(seconds / 300) * 300;
  return Math.max(10, Math.ceil(seconds / 10) * 10);
}
