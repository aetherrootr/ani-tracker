"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDesktopPlatform } from "@/components/layout/platform-layout";
import { Button } from "@/components/ui/button";
import { FloatingSearchInput } from "@/components/ui/floating-search-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SelectField } from "@/components/ui/select-field";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import type { ImportProvider, LibraryAirStatusFilter, LibrarySeasonZeroFilter, LibrarySort, LibraryStatusFilter, LibraryUnwatchedFilter, SortOrder } from "@/features/library/types";

type Options = {
  status: LibraryStatusFilter;
  provider: string;
  unwatched: LibraryUnwatchedFilter;
  airStatus: LibraryAirStatusFilter;
  seasonZero: LibrarySeasonZeroFilter;
  sort: LibrarySort;
  order: SortOrder;
};

type Props = Options & {
  q: string;
  providers: ImportProvider[];
  total: number;
  busy: boolean;
  onSearchChange: (value: string) => void;
  onOptionsChange: (value: Partial<Options>) => void;
};

const DEFAULT_OPTIONS: Options = {
  status: "all",
  provider: "all",
  unwatched: "all",
  airStatus: "all",
  seasonZero: "exclude",
  sort: "updatedAt",
  order: "desc",
};

export function LibraryToolbar(props: Props) {
  const { q, providers, total, busy, onSearchChange, onOptionsChange } = props;
  const t = useTranslations();
  const desktop = useDesktopPlatform();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Options>(() => currentOptions(props));
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const activeCount = countActiveOptions(props);

  function openFilters() {
    setDraft(currentOptions(props));
    setOpen(true);
  }

  function closeFilters() {
    setOpen(false);
  }

  function changeOptions(next: Partial<Options>) {
    if (desktop) {
      onOptionsChange(next);
      return;
    }
    setDraft((current) => ({ ...current, ...next }));
  }

  function clearOptions() {
    if (desktop) {
      onOptionsChange(DEFAULT_OPTIONS);
      return;
    }
    setDraft(DEFAULT_OPTIONS);
  }

  const closeFiltersEvent = useEffectEvent(closeFilters);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFiltersEvent();
        return;
      }
      if (desktop || event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!desktop || panelRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      closeFiltersEvent();
    }

    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const triggerElement = triggerRef.current?.querySelector("button");
    const previousInert = appShell?.inert ?? false;
    const previousOverflow = scrollContainer?.style.overflow ?? "";
    if (!desktop) {
      appShell?.setAttribute("inert", "");
      if (scrollContainer) scrollContainer.style.overflow = "hidden";
      document.documentElement.classList.add("dialog-scroll-lock");
      document.body.classList.add("dialog-scroll-lock");
    }
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(desktop ? "button, select" : "[data-filter-close]")?.focus();
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      if (!desktop) {
        if (appShell && !previousInert) appShell.removeAttribute("inert");
        if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
        document.documentElement.classList.remove("dialog-scroll-lock");
        document.body.classList.remove("dialog-scroll-lock");
      }
      triggerElement?.focus();
    };
  }, [desktop, open]);

  const values = desktop ? currentOptions(props) : draft;
  const panel = open ? (
    <FilterPanel
      ref={panelRef}
      titleId={titleId}
      modal={!desktop}
      values={values}
      providers={providers}
      activeCount={countActiveOptions(values)}
      onChange={changeOptions}
      onClear={clearOptions}
      onClose={closeFilters}
      onApply={() => {
        onOptionsChange(draft);
        closeFilters();
      }}
    />
  ) : null;

  return (
    <>
      <FloatingSearchInput
        type="search"
        value={q}
        placeholder={t("library.searchPlaceholder")}
        aria-label={t("library.searchPlaceholder")}
        aria-describedby="library-results-summary"
        onValueChange={onSearchChange}
        onKeyDown={(event) => {
          if (event.key === "Escape" && q) {
            event.preventDefault();
            onSearchChange("");
          }
        }}
        leading={<Search className="ml-3 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      >
        {q ? (
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-full" aria-label={t("library.clearSearch")} onClick={() => onSearchChange("")}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
        <span ref={triggerRef} className="contents">
          <Button
            type="button"
            variant="ghost"
            className="relative h-11 min-w-11 shrink-0 rounded-full px-3"
            aria-label={activeCount ? t("library.openFiltersActive", { count: activeCount }) : t("library.openFilters")}
            aria-expanded={open}
            aria-haspopup={desktop ? "true" : "dialog"}
            onClick={() => open ? closeFilters() : openFilters()}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {activeCount ? <span className="ml-1.5 min-w-5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeCount}</span> : null}
          </Button>
        </span>
        {desktop ? panel : null}
      </FloatingSearchInput>

      <div id="library-results-summary" className="content-status-surface mx-auto mt-2 flex min-h-10 w-full max-w-5xl items-center justify-between gap-3 text-sm text-muted-foreground" role="status" aria-live="polite">
        <span>{busy ? t("library.updatingResults") : t(activeCount ? "library.filteredResults" : "library.results", { count: total })}</span>
        {activeCount ? <button type="button" className="min-h-7 font-medium text-foreground underline-offset-4 hover:underline" onClick={() => onOptionsChange(DEFAULT_OPTIONS)}>{t("library.clearAll")}</button> : null}
      </div>

      {!desktop && open && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}

const FilterPanel = forwardRef<HTMLDivElement, {
  titleId: string;
  modal: boolean;
  values: Options;
  providers: ImportProvider[];
  activeCount: number;
  onChange: (next: Partial<Options>) => void;
  onClear: () => void;
  onClose: () => void;
  onApply: () => void;
}>(function FilterPanel({ titleId, modal, values, providers, activeCount, onChange, onClear, onClose, onApply }, ref) {
  const t = useTranslations();
  const content = (
    <div
      ref={ref}
      className={modal ? "library-filter-sheet" : "library-filter-popover"}
      role={modal ? "dialog" : "region"}
      aria-modal={modal || undefined}
      aria-labelledby={titleId}
    >
      <div className="library-filter-header">
        <div>
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{t("library.filters")}</h2>
          <p className="text-sm text-muted-foreground">{activeCount ? t("library.activeFilterCount", { count: activeCount }) : t("library.noActiveFilters")}</p>
        </div>
        <Button data-filter-close type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full" aria-label={t("library.closeFilters")} onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <ScrollArea ariaLabel={t("app.scrollableContent")} className="library-filter-content" viewportClassName="library-filter-content-viewport">
        {modal ? (
          <SelectField
            label={t("library.statusFilter")}
            value={values.status}
            options={(["all", "plan_to_watch", "watching", "completed", "on_hold"] as LibraryStatusFilter[]).map((value) => ({ value, label: t(value === "all" ? "library.allStatuses" : `library.status.${value}`) }))}
            onValueChange={(status) => onChange({ status })}
          />
        ) : (
          <ChoiceGroup label={t("library.statusFilter")} options={["all", "plan_to_watch", "watching", "completed", "on_hold"] as LibraryStatusFilter[]} value={values.status} render={(item) => t(item === "all" ? "library.allStatuses" : `library.status.${item}`)} onChange={(status) => onChange({ status })} />
        )}
        <ChoiceGroup label={t("library.unwatchedFilter")} options={["all", "yes", "no"] as LibraryUnwatchedFilter[]} value={values.unwatched} render={(item) => t(`library.unwatchedEpisodes.${item}`)} onChange={(unwatched) => onChange({ unwatched })} />
        <ChoiceGroup label={t("library.airStatusFilter")} options={["all", "notStarted", "airing", "completed"] as LibraryAirStatusFilter[]} value={values.airStatus} render={(item) => t(`library.airStatus.${item}`)} onChange={(airStatus) => onChange({ airStatus })} />
        <SelectField label={t("library.providerFilter")} value={values.provider} onValueChange={(provider) => onChange({ provider })} options={[{ value: "all", label: t("library.allProviders") }, ...providers.map((provider) => ({ value: provider.name, label: provider.label }))]} />
        <ChoiceGroup
          label={t("library.seasonZeroFilter")}
          options={["exclude", "include", "only"] as LibrarySeasonZeroFilter[]}
          value={values.seasonZero}
          render={(item) => t(`library.seasonZero.${item}`)}
          onChange={(seasonZero) => onChange({ seasonZero })}
        />
        <ChoiceGroup label={t("library.sortField")} options={["updatedAt", "name", "airDate"] as LibrarySort[]} value={values.sort} render={(item) => t(`library.sort.${item}`)} onChange={(sort) => onChange({ sort })} />
        <ChoiceGroup label={t("library.sortOrder")} options={["desc", "asc"] as SortOrder[]} value={values.order} render={(item) => t(`library.order.${item}`)} onChange={(order) => onChange({ order })} />
      </ScrollArea>

      <div className="library-filter-actions">
        <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onClear}>{t("library.resetFilters")}</Button>
        {modal ? <Button type="button" className="min-h-11 flex-1" onClick={onApply}>{t("library.applyFilters")}</Button> : null}
      </div>
    </div>
  );
  return modal ? <div className="library-filter-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>{content}</div> : content;
});

function ChoiceGroup<T extends string>({ label, options, value, render, onChange }: { label: string; options: T[]; value: T; render: (value: T) => string; onChange: (value: T) => void }) {
  return (
    <fieldset className="space-y-2 py-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-foreground">{label}</legend>
      <SlidingOptionGroup ariaLabel={label} options={options} value={value} render={render} buttonClassName="whitespace-normal text-xs" onChange={onChange} />
    </fieldset>
  );
}

function currentOptions(value: Options): Options {
  return { status: value.status, provider: value.provider, unwatched: value.unwatched, airStatus: value.airStatus, seasonZero: value.seasonZero, sort: value.sort, order: value.order };
}

function countActiveOptions(value: Options) {
  return Number(value.status !== DEFAULT_OPTIONS.status) + Number(value.provider !== DEFAULT_OPTIONS.provider) + Number(value.unwatched !== DEFAULT_OPTIONS.unwatched) + Number(value.airStatus !== DEFAULT_OPTIONS.airStatus) + Number(value.seasonZero !== DEFAULT_OPTIONS.seasonZero) + Number(value.sort !== DEFAULT_OPTIONS.sort || value.order !== DEFAULT_OPTIONS.order);
}
