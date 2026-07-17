"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

import { useDesktopPlatform } from "@/components/layout/platform-layout";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { getTrackingList, getTrackingListPage, updateEpisodeWatchState } from "@/features/library/api";
import type { TrackingListKey } from "@/features/library/api";
import { useTrackingList } from "@/features/library/hooks";
import type { TrackingListItem, TrackingListResponse } from "@/features/library/types";
import { useLocaleControls } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { SkeletonBlock } from "./LibraryPagination";
import { TrackingEpisodeRow } from "./TrackingEpisodeRow";

const TRACKING_TABS = ["tracking", "backlog", "recentlyWatched"] as const satisfies readonly TrackingListKey[];
const DESKTOP_QUEUE_TABS = ["tracking", "backlog"] as const satisfies readonly TrackingListKey[];
const SHORT_DESKTOP_QUEUE_LENGTH = 3;
const DESKTOP_PREVIEW_ITEMS = 3;

export function TrackingListPageContent() {
  const t = useTranslations();
  const { data, setData, isLoading, error, retry } = useTrackingList();
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [loadingMoreKey, setLoadingMoreKey] = useState<TrackingListKey | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState<TrackingListKey>("tracking");
  const [activeDesktopQueue, setActiveDesktopQueue] = useState<(typeof DESKTOP_QUEUE_TABS)[number]>("tracking");
  const [successNotice, setSuccessNotice] = useState<number | null>(null);
  const isDesktop = useDesktopPlatform();
  const tracking = data?.tracking.items ?? [];
  const backlog = data?.backlog.items ?? [];
  const recentlyWatched = data?.recentlyWatched.items ?? [];
  const hasQueueItems = tracking.length > 0 || backlog.length > 0;
  const activeDesktopItems = activeDesktopQueue === "tracking" ? tracking : backlog;
  const secondaryDesktopQueue = activeDesktopQueue === "tracking" ? "backlog" : "tracking";
  const secondaryDesktopItems = secondaryDesktopQueue === "tracking" ? tracking : backlog;
  const showSecondaryDesktopPreview = activeDesktopItems.length <= SHORT_DESKTOP_QUEUE_LENGTH && secondaryDesktopItems.length > 0;
  const queueTotal = (data?.tracking.total ?? tracking.length) + (data?.backlog.total ?? backlog.length);

  useEffect(() => {
    if (successNotice === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => setSuccessNotice(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [successNotice]);

  function handleMobileTabChange(tab: TrackingListKey) {
    setActiveMobileTab(tab);
  }

  async function handleWatchChange(listKey: TrackingListKey, item: TrackingListItem, watched: boolean) {
    if (!data) {
      return;
    }

    const previousIndex = data[listKey].items.findIndex((candidate) => candidate.episode.id === item.episode.id);
    const operationKey = `${listKey}-${item.anime.id}-${item.episode.id}`;
    setSavingKeys((current) => new Set(current).add(operationKey));

    try {
      await updateEpisodeWatchState(item.anime.id, item.episode.id, watched);
      const next = await getTrackingList();
      setData(watched && listKey !== "recentlyWatched" ? keepAnimeAtPosition(next, listKey, item.anime.id, previousIndex) : next);
      setSuccessNotice(Date.now());
    } catch (error) {
      throw error;
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(operationKey);
        return next;
      });
    }
  }

  async function handleLoadMore(listKey: TrackingListKey) {
    if (!data || loadingMoreKey !== null || listKey === "recentlyWatched") {
      return;
    }

    setLoadingMoreKey(listKey);
    try {
      const current = data[listKey];
      const next = await getTrackingListPage({
        list: listKey,
        limit: current.limit,
        offset: current.offset + current.items.length,
      });
      setData({
        ...data,
        [listKey]: {
          ...next,
          items: mergeTrackingItems(current.items, next.items),
        },
      });
    } finally {
      setLoadingMoreKey(null);
    }
  }

  return (
    <div className="tracking-page-container space-y-6">
      {!isDesktop ? (
        <div className="mx-auto max-w-5xl space-y-2 text-center">
          <p className="hidden text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground min-[360px]:block">{t("tracking.eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("tracking.title")}</h1>
          <p className="text-sm font-medium text-muted-foreground">
            {t("tracking.mobileQueueSummary", { current: data?.[activeMobileTab].total ?? 0, total: queueTotal })}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mx-auto max-w-5xl rounded-2xl border bg-card p-8 text-center shadow-sm">
          <p className="font-medium">{t("tracking.loadFailed")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="mt-4" onClick={retry}>{t("search.retry")}</Button>
        </div>
      ) : null}

      {!error ? (
        <div className="mx-auto w-full max-w-[1200px] space-y-4">
          {!isLoading && !hasQueueItems ? (
            <div className="mb-4 rounded-2xl bg-background/60 p-6 text-center font-medium sm:mb-6 sm:p-8">
              {t("tracking.emptyAll")}
            </div>
          ) : null}

          {!isDesktop ? (
            <div className="tracking-mobile-tabs mobile-sticky-below-top-nav sticky z-30 mx-auto w-full max-w-5xl">
              <SlidingOptionGroup
                ariaLabel={t("tracking.chooseQueue")}
                options={TRACKING_TABS}
                value={activeMobileTab}
                size="lg"
                className="w-full"
                buttonClassName="min-h-11 px-1 text-xs min-[360px]:text-sm"
                onChange={handleMobileTabChange}
                render={(tab) => tab === "tracking" ? t("tracking.trackingSection") : tab === "backlog" ? t("tracking.backlogSection") : t("tracking.recentlyWatchedSection")}
              />
            </div>
          ) : null}

          {isDesktop ? (
            <div className="tracking-desktop-layout">
              <div className="floating-surface rounded-[var(--radius-panel)] p-5">
                <div className="mb-5 rounded-[calc(var(--radius-panel)-0.35rem)] border border-[var(--border-subtle)] bg-[linear-gradient(135deg,var(--surface-card),var(--accent-soft))] p-5 shadow-[var(--shadow-low)]">
                  <div className="tracking-header-content flex flex-col gap-5">
                    <div>
                      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">{t("tracking.eyebrow")}</p>
                      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t("tracking.title")}</h1>
                    </div>
                    <div className="tracking-header-controls">
                      <div className="rounded-[var(--radius-panel)] bg-[var(--surface-card)] px-4 py-3 shadow-[var(--shadow-low)]">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("tracking.queueSummary")}</p>
                        <p className="mt-1 text-3xl font-semibold tracking-tight">{queueTotal}</p>
                      </div>
                      <SlidingOptionGroup
                        ariaLabel={t("tracking.chooseQueue")}
                        options={DESKTOP_QUEUE_TABS}
                        value={activeDesktopQueue}
                        className="w-full"
                        onChange={setActiveDesktopQueue}
                        render={(tab) => tab === "tracking" ? t("tracking.trackingSection") : t("tracking.backlogSection")}
                      />
                    </div>
                  </div>
                </div>
                {activeDesktopQueue === "tracking" ? (
                  <TrackingSection
                    title={t("tracking.trackingSection")}
                    items={tracking}
                    total={data?.tracking.total ?? 0}
                    hasMore={data?.tracking.hasMore ?? false}
                    isLoading={isLoading}
                    isLoadingMore={loadingMoreKey === "tracking"}
                    emptyText={t("tracking.emptyTracking")}
                    savingKeys={savingKeys}
                    listKey="tracking"
                    hideHeaderOnDesktop
                    onWatchChange={handleWatchChange}
                    onLoadMore={handleLoadMore}
                  />
                ) : (
                  <TrackingSection
                    title={t("tracking.backlogSection")}
                    items={backlog}
                    total={data?.backlog.total ?? 0}
                    hasMore={data?.backlog.hasMore ?? false}
                    countMode="total"
                    isLoading={isLoading}
                    isLoadingMore={loadingMoreKey === "backlog"}
                    emptyText={t("tracking.emptyBacklog")}
                    savingKeys={savingKeys}
                    listKey="backlog"
                    hideHeaderOnDesktop
                    onWatchChange={handleWatchChange}
                    onLoadMore={handleLoadMore}
                  />
                )}
                {showSecondaryDesktopPreview ? (
                  <div className="mt-6 border-t border-[var(--divider)] pt-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{t("tracking.itemCount", { count: secondaryDesktopItems.length })}</p>
                        <h3 className="text-lg font-semibold tracking-tight">
                          {secondaryDesktopQueue === "tracking" ? t("tracking.trackingSection") : t("tracking.backlogSection")}
                        </h3>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => setActiveDesktopQueue(secondaryDesktopQueue)}>
                        {t("tracking.viewQueue", { queue: secondaryDesktopQueue === "tracking" ? t("tracking.trackingSection") : t("tracking.backlogSection") })}
                      </Button>
                    </div>
                    <TrackingSection
                      title={secondaryDesktopQueue === "tracking" ? t("tracking.trackingSection") : t("tracking.backlogSection")}
                      items={secondaryDesktopItems.slice(0, DESKTOP_PREVIEW_ITEMS)}
                      total={data?.[secondaryDesktopQueue].total ?? 0}
                      hasMore={false}
                      allowLoadMore={false}
                      showItemCount={false}
                      countMode={secondaryDesktopQueue === "backlog" ? "total" : "loaded"}
                      isLoading={isLoading}
                      isLoadingMore={loadingMoreKey === secondaryDesktopQueue}
                      emptyText={secondaryDesktopQueue === "tracking" ? t("tracking.emptyTracking") : t("tracking.emptyBacklog")}
                       savingKeys={savingKeys}
                      listKey={secondaryDesktopQueue}
                      hideHeaderOnDesktop
                      compact
                      onWatchChange={handleWatchChange}
                      onLoadMore={handleLoadMore}
                    />
                  </div>
                ) : null}
              </div>
              <aside className="tracking-recent-panel floating-surface min-w-0 rounded-[var(--radius-panel)] p-4">
                <TrackingSection
                  title={t("tracking.recentlyWatchedSection")}
                  items={recentlyWatched}
                  total={data?.recentlyWatched.total ?? 0}
                  hasMore={data?.recentlyWatched.hasMore ?? false}
                  allowLoadMore={false}
                  showItemCount={false}
                showEpisodeProgress={false}
                  isLoading={isLoading}
                  isLoadingMore={loadingMoreKey === "recentlyWatched"}
                  emptyText={t("tracking.emptyRecentlyWatched")}
                   savingKeys={savingKeys}
                  listKey="recentlyWatched"
                  compact
                  timeline
                  variant="recent"
                  onWatchChange={handleWatchChange}
                  onLoadMore={handleLoadMore}
                />
              </aside>
            </div>
          ) : null}

          {!isDesktop ? (
            <div className="pt-1">
              {activeMobileTab === "tracking" ? (
                <TrackingSection
                  title={t("tracking.trackingSection")}
                  items={tracking}
                  total={data?.tracking.total ?? 0}
                  hasMore={data?.tracking.hasMore ?? false}
                  isLoading={isLoading}
                  isLoadingMore={loadingMoreKey === "tracking"}
                  emptyText={t("tracking.emptyTracking")}
                  savingKeys={savingKeys}
                  listKey="tracking"
                  hideHeaderOnMobile
                  onWatchChange={handleWatchChange}
                  onLoadMore={handleLoadMore}
                />
              ) : null}
              {activeMobileTab === "backlog" ? (
                <TrackingSection
                  title={t("tracking.backlogSection")}
                  items={backlog}
                  total={data?.backlog.total ?? 0}
                  hasMore={data?.backlog.hasMore ?? false}
                  countMode="total"
                  isLoading={isLoading}
                  isLoadingMore={loadingMoreKey === "backlog"}
                  emptyText={t("tracking.emptyBacklog")}
                  savingKeys={savingKeys}
                  listKey="backlog"
                  hideHeaderOnMobile
                  onWatchChange={handleWatchChange}
                  onLoadMore={handleLoadMore}
                />
              ) : null}
              {activeMobileTab === "recentlyWatched" ? (
                <TrackingSection
                  title={t("tracking.recentlyWatchedSection")}
                  items={recentlyWatched}
                  total={data?.recentlyWatched.total ?? 0}
                  hasMore={data?.recentlyWatched.hasMore ?? false}
                  allowLoadMore={false}
                  showItemCount={false}
                  showEpisodeProgress={false}
                  isLoading={isLoading}
                  isLoadingMore={loadingMoreKey === "recentlyWatched"}
                  emptyText={t("tracking.emptyRecentlyWatched")}
                  savingKeys={savingKeys}
                  listKey="recentlyWatched"
                  hideHeaderOnMobile
                  timeline
                  variant="recent"
                  onWatchChange={handleWatchChange}
                  onLoadMore={handleLoadMore}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {successNotice !== null ? (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--surface-solid)] px-4 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-medium)]" role="status" aria-live="polite">
          <CheckCircle2 className="h-5 w-5 text-[var(--watched)]" aria-hidden="true" />
          {t("tracking.updateSucceeded")}
        </div>
      ) : null}
    </div>
  );
}

function TrackingSection({
  title,
  items,
  total,
  hasMore,
  allowLoadMore = true,
  showItemCount = true,
  countMode = "loaded",
  showEpisodeProgress = true,
  hideHeaderOnMobile = false,
  hideHeaderOnDesktop = false,
  compact = false,
  timeline = false,
  isLoading,
  isLoadingMore,
  emptyText,
  savingKeys,
  listKey,
  variant = "queue",
  onWatchChange,
  onLoadMore,
}: {
  title: string;
  items: TrackingListItem[];
  total: number;
  hasMore: boolean;
  allowLoadMore?: boolean;
  showItemCount?: boolean;
  countMode?: "loaded" | "total";
  showEpisodeProgress?: boolean;
  hideHeaderOnMobile?: boolean;
  hideHeaderOnDesktop?: boolean;
  compact?: boolean;
  timeline?: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  emptyText: string;
  savingKeys: Set<string>;
  listKey: TrackingListKey;
  variant?: "queue" | "recent";
  onWatchChange: (listKey: TrackingListKey, item: TrackingListItem, watched: boolean) => Promise<void>;
  onLoadMore: (listKey: TrackingListKey) => Promise<void>;
}) {
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const currentDateKey = useCurrentDateKey();
  const scrollRef = useRef<HTMLElement | null>(null);
  const [scrollState, setScrollState] = useState({ up: false, down: false });
  const headerClassName = cn(
    "mb-3 flex items-center justify-between gap-3 sm:mb-4",
    (hideHeaderOnMobile || hideHeaderOnDesktop) && "hidden",
  );

  function getTimelineLabel(item: TrackingListItem, previous?: TrackingListItem) {
    const currentDate = getTimelineDateKey(item);
    if (previous !== undefined && currentDate === getTimelineDateKey(previous)) {
      return null;
    }

    if (!currentDate) {
      return t("tracking.watchedDateUnknown");
    }

    if (currentDate === currentDateKey) {
      return t("tracking.today");
    }
    if (currentDate === getPreviousDateKey(currentDateKey)) {
      return t("tracking.yesterday");
    }
    return t("tracking.watchedOn", { date: formatTimelineDate(currentDate, currentDateKey, locale) });
  }

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element || variant !== "recent") return;
    const max = element.scrollHeight - element.clientHeight;
    const next = { up: element.scrollTop > 2, down: element.scrollTop < max - 2 };
    setScrollState((current) => current.up === next.up && current.down === next.down ? current : next);
  }, [variant]);

  function scrollRecent(direction: 1 | -1) {
    const element = scrollRef.current;
    if (!element) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({
      top: direction * Math.max(element.clientHeight * 0.72, 220),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  useEffect(() => {
    if (variant !== "recent") return;
    const element = scrollRef.current;
    if (!element) return;
    const frame = requestAnimationFrame(updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isLoading, items.length, updateScrollState, variant]);

  return (
    <section>
      <div className={headerClassName}>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {showItemCount ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {t("tracking.itemCount", { count: countMode === "total" ? total : items.length })}
            {countMode === "loaded" && total > items.length ? ` / ${total}` : ""}
          </span>
        ) : null}
      </div>

      <div className="tracking-section-scroll-shell relative min-h-0">
        {variant === "recent" && scrollState.up ? (
          <button type="button" className="tracking-scroll-hint tracking-scroll-hint-top" aria-label={t("tracking.scrollUp")} onClick={() => scrollRecent(-1)}>
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        {variant === "recent" && scrollState.down ? (
          <button type="button" className="tracking-scroll-hint tracking-scroll-hint-bottom" aria-label={t("tracking.scrollDown")} onClick={() => scrollRecent(1)}>
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        <ScrollArea
          ref={scrollRef}
          ariaLabel={t("app.scrollableContent")}
          className="tracking-section-scroll-area min-h-0"
          showScrollbar={variant !== "recent"}
          viewportClassName={cn("tracking-section-list space-y-3 pb-1", compact && "space-y-2.5", variant === "recent" && "tracking-recent-list")}
          viewportTabIndex={compact && items.length > 0 ? 0 : undefined}
          onViewportScroll={updateScrollState}
        >
        {isLoading ? (
          Array.from({ length: compact ? 3 : 4 }).map((_, index) => <SkeletonBlock key={index} className={cn("rounded-2xl", compact ? "h-24" : "h-28")} />)
        ) : items.length > 0 ? (
          items.map((item, index) => {
            const timelineLabel = timeline ? getTimelineLabel(item, items[index - 1]) : null;
            return (
            <div key={`${listKey}-${item.anime.id}-${item.episode.id}`} className={cn(timeline && "relative pl-4", variant === "recent" && "tracking-recent-item") }>
              {timelineLabel ? (
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="h-3 w-3 rounded-full border-2 border-[var(--accent-solid)]" aria-hidden="true" />
                  {timelineLabel}
                </div>
              ) : null}
              <TrackingEpisodeRow
                item={item}
                disabled={savingKeys.has(`${listKey}-${item.anime.id}-${item.episode.id}`)}
                isSaving={savingKeys.has(`${listKey}-${item.anime.id}-${item.episode.id}`)}
                showProgress={showEpisodeProgress}
                compact={compact}
                variant={variant}
                onWatchChange={(nextItem, watched) => onWatchChange(listKey, nextItem, watched)}
              />
            </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed bg-background/60 p-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
        {!isLoading && hasMore && allowLoadMore ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={isLoadingMore}
            onClick={() => void onLoadMore(listKey)}
          >
            {isLoadingMore ? t("search.loadingMore") : t("tracking.loadMore")}
          </Button>
        ) : null}
        </ScrollArea>
      </div>
    </section>
  );
}

function getTimelineDateKey(item?: TrackingListItem) {
  const value = item?.episode.watchedAt;
  return value ? parseLocalDateKey(value) : null;
}

function parseLocalDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return formatDateKey(date);
}

function useCurrentDateKey() {
  const [dateKey, setDateKey] = useState(() => formatDateKey(new Date()));

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const timeoutId = window.setTimeout(() => {
      setDateKey(formatDateKey(new Date()));
    }, nextMidnight.getTime() - now.getTime() + 1000);

    return () => window.clearTimeout(timeoutId);
  }, [dateKey]);

  return dateKey;
}

function getPreviousDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return formatDateKey(date);
}

function formatTimelineDate(dateKey: string, currentDateKey: string, locale: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const currentYear = Number(currentDateKey.slice(0, 4));
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === currentYear ? {} : { year: "numeric" }),
  }).format(date);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function keepAnimeAtPosition(data: TrackingListResponse, listKey: "tracking" | "backlog", animeId: number, index: number) {
  const page = data[listKey];
  const nextItem = page.items.find((item) => item.anime.id === animeId);
  if (!nextItem) {
    return data;
  }

  const withoutItem = page.items.filter((item) => item.anime.id !== animeId);
  const insertAt = Math.min(Math.max(index, 0), withoutItem.length);
  return {
    ...data,
    [listKey]: {
      ...page,
      items: [
        ...withoutItem.slice(0, insertAt),
        nextItem,
        ...withoutItem.slice(insertAt),
      ],
    },
  };
}

function mergeTrackingItems(currentItems: TrackingListItem[], nextItems: TrackingListItem[]) {
  const seen = new Set(currentItems.map((item) => item.episode.id));
  const merged = [...currentItems];
  for (const item of nextItems) {
    if (seen.has(item.episode.id)) {
      continue;
    }
    seen.add(item.episode.id);
    merged.push(item);
  }
  return merged;
}
