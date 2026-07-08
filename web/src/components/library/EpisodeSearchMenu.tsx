"use client";

import { CircleHelp, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type EpisodeFilter = "all" | "watched" | "unwatched";
export type EpisodeOrder = "asc" | "desc";

export function EpisodeSearchMenu({
  q,
  filter,
  order,
  open,
  onOpenChange,
  onCloseReset,
  onChange,
}: {
  q: string;
  filter: EpisodeFilter;
  order: EpisodeOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseReset: () => void;
  onChange: (next: Partial<{ q: string; filter: EpisodeFilter; order: EpisodeOrder }>) => void;
}) {
  const t = useTranslations();
  const [helpOpen, setHelpOpen] = useState(false);

  function closeMenu() {
    setHelpOpen(false);
    onCloseReset();
    onOpenChange(false);
  }

  return (
    <div className="relative">
      <Button type="button" variant="ghost" size="icon" aria-label={t("library.episodeSearchSettings")} onClick={() => onOpenChange(!open)}>
        <Search className="h-4 w-4" />
      </Button>
      {open ? (
        <>
          <div className="fixed inset-x-4 top-24 z-50 max-h-[min(60vh,28rem)] overflow-y-auto rounded-2xl border bg-background/95 p-4 text-foreground shadow-lg shadow-background/30 backdrop-blur-xl dark:bg-background/90 md:absolute md:inset-auto md:right-0 md:top-11 md:z-30 md:max-h-none md:w-80 md:overflow-visible md:bg-background/80 md:dark:bg-background/70">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{t("library.episodeSearchMenuTitle")}</h3>
              <Button type="button" variant="ghost" size="icon" onClick={closeMenu}><X className="h-4 w-4" /></Button>
            </div>
            <div className="relative">
              <Input value={q} placeholder={t("library.searchEpisodesPlaceholder")} className="pr-11" onChange={(event) => onChange({ q: event.target.value })} />
              <button
                type="button"
                className="group absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("library.searchEpisodesHelp")}
                onClick={() => setHelpOpen((current) => !current)}
              >
                <CircleHelp className="h-4 w-4" />
                <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-56 rounded-xl border bg-background/95 p-2 text-left text-xs text-foreground shadow-lg backdrop-blur-md group-hover:block md:block md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                  {t("library.searchEpisodesHelp")}
                </span>
              </button>
              {helpOpen ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border bg-background/95 p-2 text-xs text-foreground shadow-lg backdrop-blur-md md:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <p>{t("library.searchEpisodesHelp")}</p>
                    <button type="button" className="shrink-0 text-muted-foreground" aria-label={t("library.closeFilters")} onClick={() => setHelpOpen(false)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "unwatched", "watched"] as EpisodeFilter[]).map((item) => <Button key={item} type="button" size="sm" variant={filter === item ? "default" : "outline"} onClick={() => onChange({ filter: item })}>{t(`library.episodeFilter.${item}`)}</Button>)}
            </div>
            <div className="mt-3 flex gap-2">
              {(["asc", "desc"] as EpisodeOrder[]).map((item) => <Button key={item} type="button" size="sm" variant={order === item ? "default" : "outline"} onClick={() => onChange({ order: item })}>{t(`library.order.${item}`)}</Button>)}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
