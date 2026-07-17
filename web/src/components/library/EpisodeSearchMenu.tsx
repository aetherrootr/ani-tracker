"use client";

import { CircleHelp, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";

export type EpisodeFilter = "all" | "watched" | "unwatched";
export type EpisodeOrder = "asc" | "desc";

export function EpisodeSearchMenu({
  q,
  filter,
  order,
  open,
  onOpenChange,
  onReset,
  onChange,
}: {
  q: string;
  filter: EpisodeFilter;
  order: EpisodeOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  onChange: (next: Partial<{ q: string; filter: EpisodeFilter; order: EpisodeOrder }>) => void;
}) {
  const t = useTranslations();
  const [helpOpen, setHelpOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector("input")?.focus());
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onOpenChange(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setHelpOpen(false);
      onOpenChange(false);
      requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  function closeMenu() {
    setHelpOpen(false);
    onOpenChange(false);
    requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
  }

  return (
    <div ref={triggerRef} className="relative">
      <Button type="button" variant="ghost" size="icon" className="relative min-h-11 min-w-11" aria-label={t("library.episodeSearchSettings")} aria-expanded={open} aria-haspopup="dialog" aria-controls={panelId} onClick={() => onOpenChange(!open)}>
        <Search className="h-4 w-4" />
        {q || filter !== "all" ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--accent-solid)]" aria-hidden="true" /> : null}
      </Button>
      {open ? (
        <>
           <div ref={panelRef} id={panelId} className="glass-dialog mobile-top-popover-enter fixed inset-x-4 top-24 z-50 rounded-2xl border text-foreground md:absolute md:inset-auto md:right-0 md:top-11 md:z-30 md:w-80 md:animate-none" role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`}>
            <ScrollArea ariaLabel={t("app.scrollableContent")} className="max-h-[min(60vh,28rem)] md:max-h-none" viewportClassName="max-h-[min(60vh,28rem)] p-4 md:max-h-none md:overflow-visible">
              <div className="mb-3 flex items-center justify-between">
                 <h3 id={`${panelId}-title`} className="font-semibold">{t("library.episodeSearchMenuTitle")}</h3>
                 <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("library.closeEpisodeFilters")} onClick={closeMenu}><X className="h-4 w-4" /></Button>
              </div>
              <div className="relative">
                 <Input type="search" value={q} placeholder={t("library.searchEpisodesPlaceholder")} className="pr-12" onChange={(event) => onChange({ q: event.target.value })} />
                <button
                  type="button"
                   className="group absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("library.searchEpisodesHelp")}
                  onClick={() => setHelpOpen((current) => !current)}
                >
                  <CircleHelp className="h-4 w-4" />
                  <span className="glass-dialog pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden w-56 rounded-xl border p-2 text-left text-xs text-foreground group-hover:block md:block md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                    {t("library.searchEpisodesHelp")}
                  </span>
                </button>
                {helpOpen ? (
                  <div className="glass-dialog absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border p-2 text-xs text-foreground md:hidden">
                    <div className="flex items-start justify-between gap-2">
                      <p>{t("library.searchEpisodesHelp")}</p>
                       <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground" aria-label={t("library.closeHelp")} onClick={() => setHelpOpen(false)}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
               <SlidingOptionGroup
                ariaLabel={t("library.statusLabel")}
                className="mt-3"
                options={["all", "unwatched", "watched"] as const}
                value={filter}
                render={(item) => t(`library.episodeFilter.${item}`)}
                onChange={(item) => onChange({ filter: item })}
               />
               {q || filter !== "all" ? <Button type="button" variant="ghost" className="mt-3 min-h-11 w-full" onClick={onReset}>{t("library.resetEpisodeFilters")}</Button> : null}
              <SlidingOptionGroup
                ariaLabel={t("library.sortOrder")}
                className="mt-3"
                options={["asc", "desc"] as const}
                value={order}
                render={(item) => t(`library.order.${item}`)}
                onChange={(item) => onChange({ order: item })}
              />
            </ScrollArea>
          </div>
        </>
      ) : null}
    </div>
  );
}
