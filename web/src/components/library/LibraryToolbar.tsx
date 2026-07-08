"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LibrarySort, LibraryStatusFilter, SortOrder } from "@/features/library/types";
import { cn } from "@/lib/utils";

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
    <div className="sticky top-[7.25rem] z-30 mx-auto w-full max-w-5xl md:top-3">
      <div className="relative flex items-center gap-2 rounded-full border bg-background/80 p-2 shadow-lg shadow-background/30 backdrop-blur-xl">
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
        <Input
          value={q}
          placeholder={t("library.searchPlaceholder")}
          className="h-10 rounded-full border-0 bg-transparent shadow-none focus-visible:ring-0"
          onChange={(event) => onSearchChange(event.target.value)}
        />

        {open ? (
          <div className="absolute left-0 top-14 z-40 w-full rounded-2xl border bg-background/80 p-4 text-foreground shadow-lg shadow-background/30 backdrop-blur-xl sm:left-2 sm:w-80 dark:bg-background/70">
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
      </div>
    </div>
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
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            variant="outline"
            size="default"
            className={cn(
              "min-h-11 rounded-full border-white/30 bg-background/10 px-4 text-foreground shadow-sm backdrop-blur-xl hover:bg-background/25 dark:border-white/10 dark:bg-background/5 dark:hover:bg-background/20",
              option === value && "border-primary/35 bg-primary/60 text-primary-foreground shadow-md hover:bg-primary/70 dark:bg-primary/55 dark:hover:bg-primary/65",
            )}
            onClick={() => onChange(option)}
          >
            {render(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}
