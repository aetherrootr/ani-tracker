"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  totalPages: number;
  total: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
};

export function LibraryPagination({ page, totalPages, total, disabled, onPageChange }: Props) {
  const t = useTranslations();
  const [inputPage, setInputPage] = useState(String(page));
  const pages = buildPages(page, totalPages);
  const canPrevious = page > 1 && !disabled;
  const canNext = page < totalPages && !disabled;

  function jump(target: number) {
    const next = Math.min(Math.max(target, 1), Math.max(totalPages, 1));
    setInputPage(String(next));
    if (next !== page) {
      onPageChange(next);
    }
  }

  return (
    <nav
      className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3 text-sm shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between"
      aria-label={t("library.pagination")}
    >
      <div className="text-muted-foreground">
        {t("library.pageSummary", {
          page: totalPages === 0 ? 0 : page,
          totalPages,
          total,
        })}
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrevious}
          onClick={() => jump(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t("library.previous")}</span>
        </Button>

        <div className="hidden items-center gap-1 md:flex">
          {pages.map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? "default" : "ghost"}
                size="sm"
                className="min-w-9 px-2"
                disabled={disabled}
                aria-current={item === page ? "page" : undefined}
                onClick={() => jump(item)}
              >
                {item}
              </Button>
            ),
          )}
        </div>

        <form
          className="flex items-center gap-1 md:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            jump(Number(inputPage));
          }}
        >
          <Input
            aria-label={t("library.jumpPage")}
            value={inputPage}
            inputMode="numeric"
            className="h-9 w-16 text-center"
            onChange={(event) => setInputPage(event.target.value)}
          />
          <span className="text-muted-foreground">/ {totalPages}</span>
        </form>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => jump(page + 1)}
        >
          <span className="hidden sm:inline">{t("library.next")}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

export function buildPages(page: number, totalPages: number) {
  const set = new Set<number>([1, totalPages, page - 1, page, page + 1].filter((item) => item >= 1 && item <= totalPages));
  const sorted = Array.from(set).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];

  for (const item of sorted) {
    const last = result[result.length - 1];
    if (typeof last === "number" && item - last > 1) {
      result.push("ellipsis");
    }
    result.push(item);
  }

  return result;
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}
