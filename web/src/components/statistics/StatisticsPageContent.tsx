"use client";

import { BarChart3, CalendarDays, Clock3, Library, RefreshCw, TimerReset } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/features/auth/hooks";
import { assetUrl } from "@/features/library/api";
import { useStatisticsSummary, useWatchTimeline } from "@/features/statistics/hooks";
import type { StatisticsDay, StatisticsSummary, StatisticsWeek, WatchTimelineItem } from "@/features/statistics/types";
import { cn } from "@/lib/utils";

export function StatisticsPageContent() {
  const t = useTranslations();
  const { user } = useCurrentUser();
  const summary = useStatisticsSummary(user?.weekStartDay);
  const timeline = useWatchTimeline();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  async function handleRecalculate() {
    setRefreshMessage(null);
    try {
      await summary.recalculate();
      setRefreshMessage(t("statistics.refreshSuccess"));
    } catch {
      setRefreshMessage(t("statistics.refreshFailed"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {t("statistics.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t("statistics.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("statistics.description")}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button onClick={handleRecalculate} disabled={summary.isRefreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", summary.isRefreshing && "animate-spin")} />
            {summary.isRefreshing ? t("statistics.refreshing") : t("statistics.refresh")}
          </Button>
          {refreshMessage ? <p className="text-xs text-muted-foreground">{refreshMessage}</p> : null}
        </div>
      </div>

      {summary.error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{t("statistics.loadFailed")}</p>
            <Button variant="outline" onClick={summary.retry}>{t("statistics.retry")}</Button>
          </CardContent>
        </Card>
      ) : null}

      {summary.data ? (
        <StatisticsSection title={t("statistics.groups.overview")}>
          <StatisticsOverview data={summary.data} />
        </StatisticsSection>
      ) : <OverviewSkeleton loading={summary.isLoading} />}
      {summary.data ? (
        <StatisticsSection title={t("statistics.groups.trends")}>
          <div className="space-y-4">
            <DailyHeatmap days={summary.data.daily} />
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,0.36fr)_minmax(0,1fr)]">
              <AverageWeeklyCard data={summary.data} />
              <WeeklyWatchTime weeks={summary.data.weekly} />
            </div>
          </div>
        </StatisticsSection>
      ) : null}
      <StatisticsSection title={t("statistics.groups.timeline")}>
        <WatchTimelineSection timeline={timeline} />
      </StatisticsSection>
    </div>
  );
}

function StatisticsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function StatisticsOverview({ data }: { data: StatisticsSummary }) {
  const t = useTranslations();
  const cards = [
    {
      title: t("statistics.metrics.watchedEpisodes"),
      value: String(data.watchedEpisodeCount),
      unit: t("statistics.units.episodes"),
      description: t("statistics.metrics.watchedEpisodesHint"),
      icon: BarChart3,
    },
    {
      title: t("statistics.metrics.unwatchedAired"),
      value: String(data.unwatchedAiredEpisodeCount),
      unit: t("statistics.units.episodes"),
      description: t("statistics.metrics.unwatchedAiredHint"),
      icon: TimerReset,
    },
    {
      title: t("statistics.metrics.totalWatchTime"),
      value: formatDuration(data.totalWatchSeconds, t),
      unit: "",
      description: t("statistics.metrics.totalWatchTimeHint"),
      icon: Clock3,
    },
    {
      title: t("statistics.metrics.libraryAnime"),
      value: String(data.libraryAnimeCount),
      unit: t("statistics.units.anime"),
      description: t("statistics.metrics.libraryAnimeHint"),
      icon: Library,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight">{card.value}</span>
                {card.unit ? <Badge variant="secondary">{card.unit}</Badge> : null}
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function OverviewSkeleton({ loading }: { loading: boolean }) {
  if (!loading) {
    return null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-4 p-4">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-8 w-20 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AverageWeeklyCard({ data }: { data: StatisticsSummary }) {
  const t = useTranslations();
  const recentQuarterWatchSeconds = data.weekly.reduce((total, week) => total + week.watchSeconds, 0);
  const averageWeeklyWatchSeconds = Math.round(recentQuarterWatchSeconds / 13);

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex h-full flex-col gap-5 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{t("statistics.metrics.quarterStats")}</p>
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <CalendarDays className="h-4 w-4" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid gap-2">
            <div className="rounded-xl border bg-background/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t("statistics.metrics.averageWeekly")}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">{data.averageWeeklyWatchedEpisodesLastQuarter}</span>
                <Badge variant="secondary">{t("statistics.units.episodesPerWeek")}</Badge>
              </div>
            </div>
            <div className="rounded-xl border bg-background/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t("statistics.metrics.quarterWatchTime")}</p>
              <p className="mt-1 text-sm font-semibold">{formatDuration(recentQuarterWatchSeconds, t)}</p>
            </div>
            <div className="rounded-xl border bg-background/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t("statistics.metrics.averageWeeklyWatchTime")}</p>
              <p className="mt-1 text-sm font-semibold">{formatDuration(averageWeeklyWatchSeconds, t)}</p>
            </div>
          </div>
        </div>
        <p className="mt-auto text-xs leading-5 text-muted-foreground">{t("statistics.metrics.quarterStatsHint")}</p>
      </CardContent>
    </Card>
  );
}

function DailyHeatmap({ days }: { days: StatisticsDay[] }) {
  const t = useTranslations();
  const [selectedDay, setSelectedDay] = useState<StatisticsDay | null>(days.at(-1) ?? null);
  const maxCount = Math.max(1, ...days.map((day) => day.watchedEpisodeCount));

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>{t("statistics.daily.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mx-auto w-full max-w-[1600px]">
          <div className="px-3">
            <div className="mb-4 rounded-xl border bg-background/40 p-3">
              {selectedDay ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{formatIsoDate(selectedDay.date)}</Badge>
                  <span className="font-medium">
                    {t("statistics.daily.selected", { count: selectedDay.watchedEpisodeCount })}
                  </span>
                  <span className="text-muted-foreground">{formatDuration(selectedDay.watchSeconds, t)}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("statistics.daily.selectPrompt")}</p>
              )}
            </div>
          </div>
          <div className="overflow-x-auto px-3 py-3">
            <div className="grid min-w-[720px] grid-flow-col grid-rows-7 gap-1 sm:min-w-0">
              {days.map((day) => {
                const label = t("statistics.daily.tooltip", {
                  date: formatIsoDate(day.date),
                  count: day.watchedEpisodeCount,
                  duration: formatDuration(day.watchSeconds, t),
                });
                return (
                  <button
                    key={day.date}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={selectedDay?.date === day.date}
                    onClick={() => setSelectedDay(day)}
                    onFocus={() => setSelectedDay(day)}
                    className={cn(
                      "aspect-square w-full min-w-3 rounded-[4px] border border-border transition-transform focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:scale-125",
                      selectedDay?.date === day.date && "ring-2 ring-ring ring-offset-2",
                      heatmapClass(day.watchedEpisodeCount, maxCount),
                    )}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("statistics.daily.less")}</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className={cn("h-4 w-4 rounded-[4px] border", heatmapLevelClass(level))} />
            ))}
          </div>
          <span>{t("statistics.daily.more")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function WeeklyWatchTime({ weeks }: { weeks: StatisticsWeek[] }) {
  const t = useTranslations();
  const isNarrowScreen = useIsNarrowScreen();
  const visibleWeeks = isNarrowScreen ? weeks.slice(-7) : weeks;
  const [selectedWeek, setSelectedWeek] = useState<StatisticsWeek | null>(visibleWeeks.at(-1) ?? null);
  const activeWeek = visibleWeeks.some((week) => week.weekStartDate === selectedWeek?.weekStartDate)
    ? selectedWeek
    : visibleWeeks.at(-1) ?? null;
  const maxSeconds = Math.max(1, ...visibleWeeks.map((week) => week.watchSeconds));
  const chartWidth = 720;
  const chartHeight = 220;
  const padding = { top: 24, right: 20, bottom: 30, left: 42 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const points = visibleWeeks.map((week, index) => {
    const x = padding.left + (visibleWeeks.length <= 1 ? plotWidth : index / (visibleWeeks.length - 1) * plotWidth);
    const y = padding.top + plotHeight - week.watchSeconds / maxSeconds * plotHeight;
    return { week, x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("statistics.weekly.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("statistics.weekly.description")}</p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-xl border bg-background/40 p-3">
          {activeWeek ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">
                {formatIsoDate(activeWeek.weekStartDate)} - {formatIsoDate(activeWeek.weekEndDate)}
              </Badge>
              <span className="font-medium">{t("statistics.weekly.episodes", { count: activeWeek.watchedEpisodeCount })}</span>
              <span className="text-muted-foreground">{formatDuration(activeWeek.watchSeconds, t)}</span>
            </div>
          ) : null}
        </div>
        <div className="pb-2">
          <svg className="w-full" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={t("statistics.weekly.chartLabel")}>
            <line x1={padding.left} y1={padding.top + plotHeight} x2={chartWidth - padding.right} y2={padding.top + plotHeight} className="stroke-border" />
            <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} className="stroke-border" />
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={padding.left}
                y1={padding.top + plotHeight - ratio * plotHeight}
                x2={chartWidth - padding.right}
                y2={padding.top + plotHeight - ratio * plotHeight}
                className="stroke-border/60"
                strokeDasharray="4 6"
              />
            ))}
            <path d={linePath} fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point) => {
              const isSelected = activeWeek?.weekStartDate === point.week.weekStartDate;
              const label = t("statistics.weekly.tooltip", {
                start: formatIsoDate(point.week.weekStartDate),
                end: formatIsoDate(point.week.weekEndDate),
                count: point.week.watchedEpisodeCount,
                duration: formatDuration(point.week.watchSeconds, t),
              });
              return (
                <g
                  key={point.week.weekStartDate}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  className="cursor-pointer outline-none"
                  onClick={() => setSelectedWeek(point.week)}
                  onFocus={() => setSelectedWeek(point.week)}
                >
                  <title>{label}</title>
                  <circle cx={point.x} cy={point.y} r={isNarrowScreen ? 18 : 12} className="fill-transparent" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? 6 : 4.5}
                    className={cn("pointer-events-none fill-background stroke-primary transition-all", isSelected && "fill-primary")}
                    strokeWidth={isSelected ? 4 : 3}
                  />
                </g>
              );
            })}
            {visibleWeeks[0] ? <text x={padding.left} y={chartHeight - 8} className="fill-muted-foreground text-[11px]">{formatIsoDate(visibleWeeks[0].weekStartDate)}</text> : null}
            {visibleWeeks.at(-1) ? <text x={chartWidth - padding.right} y={chartHeight - 8} textAnchor="end" className="fill-muted-foreground text-[11px]">{formatIsoDate(visibleWeeks.at(-1)?.weekStartDate ?? "")}</text> : null}
            <text x={8} y={padding.top + 4} className="fill-muted-foreground text-[11px]">{formatDuration(maxSeconds, t)}</text>
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{t("statistics.weekly.oldest")}</span>
          <span>{t("statistics.weekly.newest")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function useIsNarrowScreen() {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 640px)").matches;
  });

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const handleChange = () => setIsNarrow(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isNarrow;
}

function WatchTimelineSection({ timeline }: { timeline: ReturnType<typeof useWatchTimeline> }) {
  const t = useTranslations();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void timeline.loadMore();
      }
    }, { rootMargin: "240px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [timeline]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("statistics.timeline.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.isLoading ? <p className="text-sm text-muted-foreground">{t("statistics.timeline.loading")}</p> : null}
        {!timeline.isLoading && timeline.items.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("statistics.timeline.empty")}
          </p>
        ) : null}
        <div className="space-y-3">
          {timeline.items.map((item, index) => {
            const currentDay = timelineDateKey(item.episode.watchedAt);
            const previousDay = timelineDateKey(timeline.items[index - 1]?.episode.watchedAt ?? null);
            return (
              <div key={`${item.episode.id}-${item.episode.watchedAt}`} className="space-y-3">
                {currentDay !== previousDay ? <TimelineDateSeparator date={currentDay} /> : null}
                <TimelineItem item={item} />
              </div>
            );
          })}
        </div>
        {timeline.error ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{t("statistics.timeline.loadFailed")}</p>
            <Button variant="outline" onClick={timeline.items.length ? timeline.loadMore : timeline.retry}>
              {t("statistics.retry")}
            </Button>
          </div>
        ) : null}
        <div ref={sentinelRef} className="h-8" />
        {!timeline.isLoading && timeline.isLoadingMore ? <p className="text-center text-sm text-muted-foreground">{t("statistics.timeline.loadingMore")}</p> : null}
        {!timeline.isLoading && !timeline.hasMore && timeline.items.length > 0 ? <p className="text-center text-sm text-muted-foreground">{t("statistics.timeline.noMore")}</p> : null}
      </CardContent>
    </Card>
  );
}

function TimelineItem({ item }: { item: WatchTimelineItem }) {
  const t = useTranslations();
  const poster = assetUrl(item.anime.posterUrl);
  const episodeHref = `/library/${item.anime.id}?episode=${item.episode.episodeNumber}#episode-${item.episode.id}`;

  return (
    <div className="flex gap-3 rounded-xl border bg-background/40 p-3">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt={t("anime.coverAlt", { title: item.anime.displayName })} className="h-20 w-14 rounded-lg object-cover" />
      ) : (
        <div className="flex h-20 w-14 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
          {t("anime.noCover")}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Link href={episodeHref} className="block truncate text-sm font-medium hover:text-primary hover:underline">
          {item.anime.displayName}
        </Link>
        <Link href={episodeHref} className="mt-1 block text-sm text-muted-foreground hover:text-primary hover:underline">
          {t("statistics.timeline.episode", { episode: item.episode.episodeNumber })}
          {item.episode.displayName ? ` · ${item.episode.displayName}` : ""}
        </Link>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">{formatDateTime(item.episode.watchedAt)}</Badge>
          {item.episode.durationSeconds !== null ? (
            <Badge variant="outline">{formatDuration(item.episode.durationSeconds, t)}</Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineDateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs font-medium text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span className="rounded-full border bg-background px-3 py-1">{date}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function timelineDateKey(value: string | null) {
  return value?.slice(0, 10) ?? "-";
}

function heatmapClass(count: number, maxCount: number) {
  if (count <= 0) {
    return heatmapLevelClass(0);
  }
  return heatmapLevelClass(Math.min(4, Math.max(1, Math.ceil(count / maxCount * 4))));
}

function heatmapLevelClass(level: number) {
  return [
    "bg-muted",
    "bg-emerald-200 dark:bg-emerald-950",
    "bg-emerald-300 dark:bg-emerald-800",
    "bg-emerald-500 dark:bg-emerald-600",
    "bg-emerald-700 dark:bg-emerald-400",
  ][level];
}

function formatDuration(seconds: number, t: ReturnType<typeof useTranslations>) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return t("statistics.duration.hoursMinutesSeconds", { hours, minutes, seconds: remainingSeconds });
  }
  if (minutes > 0) {
    return t("statistics.duration.minutesSeconds", { minutes, seconds: remainingSeconds });
  }
  return t("statistics.duration.seconds", { seconds: remainingSeconds });
}

function formatIsoDate(value: string) {
  return value.slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
