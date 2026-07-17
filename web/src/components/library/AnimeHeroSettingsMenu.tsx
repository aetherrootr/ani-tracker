"use client";

import Image from "next/image";
import { Check, Plus, RefreshCw, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { assetUrl, updateAnimeNamePreference, updatePosterPreference, updateSummaryPreference } from "@/features/library/api";
import type { Anime } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { NoPoster } from "./NoPoster";

type Dialog = "name" | "poster" | "summary" | null;

export function AnimeHeroSettingsMenu({
  anime,
  isSyncing = false,
  isDiscoveringSeasons = false,
  canDiscoverRelatedAnime = false,
  isLocalSnapshot = false,
  onAnimeChange,
  onSyncAnime,
  onDiscoverRelatedAnime,
  onManageManualRelated,
}: {
  anime: Anime;
  isSyncing?: boolean;
  isDiscoveringSeasons?: boolean;
  canDiscoverRelatedAnime?: boolean;
  isLocalSnapshot?: boolean;
  onAnimeChange: (anime: Anime) => void;
  onSyncAnime?: () => void;
  onDiscoverRelatedAnime?: () => void;
  onManageManualRelated?: () => void;
}) {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top?: number; width: number } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function positionMenu() {
      const trigger = triggerRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      if (window.innerWidth < 768) {
        setMenuRect({ left: 12, width: window.innerWidth - 24 });
      } else {
        const width = 288;
        setMenuRect({ left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), top: rect.bottom + 8, width });
      }
    }
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
        return;
      } else return;
      event.preventDefault();
      items[next]?.focus();
    }
    positionMenu();
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not([disabled])")?.focus());
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen]);

  async function chooseName(nameId: number | null) {
    setError(null);
    try {
      const result = await updateAnimeNamePreference(anime.id, nameId);
      onAnimeChange({
        ...anime,
        name: result.name,
        preferredNameId: result.progress.preferredNameId,
        displayName: result.name?.name ?? anime.originalName,
      });
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.saveFailed"));
    }
  }

  async function chooseSummary(summaryId: number | null) {
    setError(null);
    try {
      const result = await updateSummaryPreference(anime.id, summaryId);
      onAnimeChange({ ...anime, summary: result.summary });
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.saveFailed"));
    }
  }

  async function choosePoster(posterId: number | null) {
    setError(null);
    try {
      const result = await updatePosterPreference(anime.id, posterId);
      onAnimeChange({
        ...anime,
        poster: result.poster ?? anime.poster,
        preferredPosterId: result.progress.preferredPosterId,
        posterUrl: result.poster?.url ?? anime.posterUrl,
      });
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("library.saveFailed"));
    }
  }

  return (
    <>
      <div ref={triggerRef} className="relative z-20 shrink-0">
        <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-xl bg-background/70 backdrop-blur" aria-label={t("library.heroSettings")} aria-expanded={menuOpen} aria-haspopup="menu" aria-controls="anime-hero-settings-menu" onClick={() => setMenuOpen((current) => !current)}>
          <Settings className="h-4 w-4" />
        </Button>
        {menuOpen && menuRect && typeof document !== "undefined" ? createPortal(
          <div ref={menuRef} id="anime-hero-settings-menu" className="glass-dialog fixed bottom-3 z-[100] max-h-[calc(100svh-1.5rem)] overflow-y-auto rounded-2xl border p-2 text-sm text-foreground md:bottom-auto" style={menuRect} role="menu">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("library.heroMenu.content")}</div>
            <MenuButton onClick={() => { setDialog("name"); setMenuOpen(false); }}>{t("library.changeTitle")}</MenuButton>
            <MenuButton onClick={() => { setDialog("poster"); setMenuOpen(false); }}>{t("library.changePoster")}</MenuButton>
            <MenuButton onClick={() => { setDialog("summary"); setMenuOpen(false); }}>{t("library.summaryPreference")}</MenuButton>
            <div className="my-2 h-px bg-[var(--divider)]" />
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("library.heroMenu.maintenance")}</div>
            {onSyncAnime ? (
              <MenuButton disabled={isSyncing || isLocalSnapshot} onClick={() => { onSyncAnime(); setMenuOpen(false); }}>
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
                  {isSyncing ? t("library.syncing") : t("library.syncAnime")}
                </span>
              </MenuButton>
            ) : null}
            {canDiscoverRelatedAnime && onDiscoverRelatedAnime ? (
              <MenuButton disabled={isDiscoveringSeasons} onClick={() => { onDiscoverRelatedAnime(); setMenuOpen(false); }}>
                <span className="inline-flex items-center gap-2">
                  {isDiscoveringSeasons ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {isDiscoveringSeasons ? t("library.tvdbSeasonDiscovering") : t("library.tvdbSeasonDiscovery")}
                </span>
              </MenuButton>
            ) : null}
            {onManageManualRelated ? (
              <MenuButton onClick={() => { onManageManualRelated(); setMenuOpen(false); }}>
                <span className="block">{t("library.manageManualRelatedAnime")}</span>
                <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">{t("library.manageManualRelatedAnimeHint")}</span>
              </MenuButton>
            ) : null}
          </div>,
          document.body,
        ) : null}
      </div>

      <ChoiceDialog open={dialog === "name"} title={t("library.changeTitle")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
        <ChoiceButton active={anime.preferredNameId === null} onClick={() => chooseName(null)}>{anime.originalName}</ChoiceButton>
        {(anime.availableNames ?? []).map((name) => (
          <ChoiceButton key={name.id} active={anime.preferredNameId === name.id} onClick={() => chooseName(name.id)}>
            {name.name}<span className="text-muted-foreground">{name.language ?? "-"}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "summary"} title={t("library.summaryPreference")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
        <ChoiceButton active={false} onClick={() => chooseSummary(null)}>{t("library.defaultPreference")}</ChoiceButton>
        {(anime.availableSummaries ?? []).map((summary) => (
          <ChoiceButton key={summary.id} active={anime.summary?.id === summary.id} onClick={() => chooseSummary(summary.id)}>
            <span>{summary.language ?? "-"}</span><span className="line-clamp-2 text-left text-muted-foreground">{summary.summary}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "poster"} title={t("library.changePoster")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
        <div className="grid grid-cols-3 gap-3">
          {(anime.availablePosters ?? []).map((poster) => {
            const url = assetUrl(poster.url);
            return (
              <button key={poster.id} type="button" role="radio" aria-checked={anime.preferredPosterId === poster.id || poster.isPreferred} aria-label={t("library.posterChoiceLabel", { index: poster.id, status: poster.status === "ready" ? t("library.posterReady") : t("library.posterPending") })} className={cn("overflow-hidden rounded-xl border p-1 text-left", (anime.preferredPosterId === poster.id || poster.isPreferred) && "ring-2 ring-primary", poster.status !== "ready" && "opacity-45")} onClick={() => choosePoster(poster.id)}>
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
                  {url ? <Image src={url} alt="" fill unoptimized sizes="120px" className="object-cover" /> : <NoPoster />}
                </div>
                <div className="mt-1 text-center text-[11px] text-muted-foreground">{poster.status === "ready" ? t("library.posterReady") : t("library.posterPending")}</div>
              </button>
            );
          })}
        </div>
      </ChoiceDialog>
    </>
  );
}

function MenuButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button type="button" role="menuitem" disabled={disabled} className="block min-h-11 w-full rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-50" onClick={onClick}>{children}</button>;
}

function ChoiceDialog({ open, title, error, children, restoreFocusRef, onClose }: { open: boolean; title: string; error: string | null; children: ReactNode; restoreFocusRef: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const t = useTranslations();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeDialog = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const restoreFocusElement = restoreFocusRef.current?.querySelector("button");
    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const previousInert = appShell?.inert ?? false;
    const previousOverflow = scrollContainer?.style.overflow ?? "";
    appShell?.setAttribute("inert", "");
    if (scrollContainer) scrollContainer.style.overflow = "hidden";
    document.documentElement.classList.add("dialog-scroll-lock");
    document.body.classList.add("dialog-scroll-lock");
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true'], [data-dialog-close], button")?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) event.preventDefault();
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (appShell && !previousInert) appShell.removeAttribute("inert");
      if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
      document.documentElement.classList.remove("dialog-scroll-lock");
      document.body.classList.remove("dialog-scroll-lock");
      restoreFocusElement?.focus();
    };
  }, [open, restoreFocusRef]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-background/88 p-3 backdrop-blur-md sm:items-center sm:p-4" role="presentation" onClick={onClose}>
      <div ref={dialogRef} className="glass-dialog max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-hidden rounded-[var(--radius-modal)] border text-foreground" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <ScrollArea ariaLabel={t("app.scrollableContent")} className="max-h-[calc(100dvh-1.5rem)]" viewportClassName="max-h-[calc(100dvh-1.5rem)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" data-dialog-close aria-label={t("library.closeChoiceDialog")} onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-2" role="radiogroup">{children}</div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </ScrollArea>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={active} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" onClick={onClick}>{children}{active ? <Check className="h-4 w-4" /> : null}</button>;
}
