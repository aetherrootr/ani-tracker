"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FloatingSearchInput } from "@/components/ui/floating-search-input";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import type { LibrarySort, LibraryStatusFilter, SortOrder } from "@/features/library/types";

type Props = {
  q: string;
  status: LibraryStatusFilter;
  sort: LibrarySort;
  order: SortOrder;
  onSearchChange: (value: string) => void;
  onOptionsChange: (value: { status?: LibraryStatusFilter; sort?: LibrarySort; order?: SortOrder }) => void;
};

export function LibraryToolbar({ q, status, sort, order, onSearchChange, onOptionsChange }: Props) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <FloatingSearchInput
      value={q}
      placeholder={t("library.searchPlaceholder")}
      aria-label={t("library.searchPlaceholder")}
      onChange={(event) => onSearchChange(event.target.value)}
      leading={(
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t("library.openFilters")}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      )}
    >
      {open ? (
        <div className="glass-dialog absolute left-0 top-14 z-40 w-full rounded-2xl border p-4 text-foreground sm:left-2 sm:w-[28rem]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t("library.filters")}</h2>
            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full" aria-label={t("library.closeFilters")} onClick={() => setOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <OptionGroup
            label={t("library.statusFilter")}
            options={["all", "plan_to_watch", "watching", "completed", "on_hold"]}
            value={status}
            render={(item) => t(item === "all" ? "library.allStatuses" : `library.status.${item}`)}
            onChange={(next) => onOptionsChange({ status: next as LibraryStatusFilter })}
          />
          <OptionGroup
            label={t("library.sortField")}
            options={["updatedAt", "name", "airDate"]}
            value={sort}
            render={(item) => t(`library.sort.${item}`)}
            onChange={(next) => onOptionsChange({ sort: next as LibrarySort })}
          />
          <OptionGroup
            label={t("library.sortOrder")}
            options={["desc", "asc"]}
            value={order}
            render={(item) => t(`library.order.${item}`)}
            onChange={(next) => onOptionsChange({ order: next as SortOrder })}
          />
        </div>
      ) : null}
    </FloatingSearchInput>
  );
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  render,
  onChange,
}: {
  label: string;
  options: T[];
  value: string;
  render: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-foreground">{label}</div>
      <SlidingOptionGroup
        options={options}
        value={value as T}
        render={render}
        buttonClassName="whitespace-nowrap text-[11px] sm:text-xs"
        onChange={onChange}
      />
    </div>
  );
}
