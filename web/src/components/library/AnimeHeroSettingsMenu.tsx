"use client";

import Image from "next/image";
import { Check, Plus, RefreshCw, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode, RefObject } from "react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDesktopPlatform } from "@/components/layout/platform-layout";
import { Button } from "@/components/ui/button";
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
  const desktop = useDesktopPlatform();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top?: number; width: number } | null>(null);
  function closeMenu(restoreFocus = true) {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
  }
  const closeMenuEvent = useEffectEvent(closeMenu);

  useEffect(() => {
    if (!menuOpen) return;
    function positionMenu() {
      const trigger = triggerRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      if (!desktop) {
        setMenuRect({ left: 0, width: window.innerWidth });
      } else {
        const width = 288;
        setMenuRect({ left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), top: rect.bottom + 8, width });
      }
    }
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenuEvent();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (!desktop && event.key === "Tab") {
        const focusable = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        closeMenuEvent();
        return;
      } else return;
      event.preventDefault();
      items[next]?.focus();
    }
    const appShell = document.getElementById("app-shell");
    const scrollContainer = document.getElementById("app-mobile-scroll-container");
    const previousInert = appShell?.inert ?? false;
    const previousOverflow = scrollContainer?.style.overflow ?? "";
    if (!desktop) {
      appShell?.setAttribute("inert", "");
      if (scrollContainer) scrollContainer.style.overflow = "hidden";
      document.documentElement.classList.add("dialog-scroll-lock");
      document.body.classList.add("dialog-scroll-lock");
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
      if (!desktop) {
        if (appShell && !previousInert) appShell.removeAttribute("inert");
        if (scrollContainer) scrollContainer.style.overflow = previousOverflow;
        document.documentElement.classList.remove("dialog-scroll-lock");
        document.body.classList.remove("dialog-scroll-lock");
      }
    };
  }, [desktop, menuOpen]);

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
      onAnimeChange({
        ...anime,
        summary: result.summary,
        availableSummaries: anime.availableSummaries?.map((summary) => ({
          ...summary,
          isPreferred: summary.id === summaryId,
        })),
      });
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
        <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-xl bg-background/70 backdrop-blur" aria-label={t("library.heroSettings")} aria-expanded={menuOpen} aria-haspopup="menu" aria-controls="anime-hero-settings-menu" onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true); }}>
          <Settings className="h-4 w-4" />
        </Button>
        {menuOpen && menuRect && typeof document !== "undefined" ? createPortal(
          <>
            {!desktop ? <div className="fixed inset-x-0 top-0 z-[calc(var(--z-popover)-1)] h-[var(--app-viewport-height)] bg-background/88 backdrop-blur-md" aria-hidden="true" /> : null}
            <div ref={menuRef} id="anime-hero-settings-menu" className={cn("glass-dialog fixed z-[var(--z-select)] flex flex-col overflow-hidden border text-sm text-foreground", desktop ? "bottom-auto max-h-[calc(var(--app-viewport-height)-2rem)] rounded-2xl" : "bottom-0 max-h-[calc(var(--app-viewport-height)-max(1rem,env(safe-area-inset-top)))] rounded-t-[var(--radius-modal)]")} style={desktop ? menuRect : { left: 0, width: "100%" }} role="menu">
              {!desktop ? <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
                <h2 className="text-lg font-semibold">{t("library.heroMenu.title")}</h2>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={t("library.heroMenu.close")} onClick={() => closeMenu()}><X className="h-4 w-4" /></Button>
              </div> : null}
              <div className="min-h-0 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("library.heroMenu.content")}</div>
                <MenuButton onClick={() => { setDialog("name"); closeMenu(false); }}>{t("library.changeTitle")}</MenuButton>
                <MenuButton onClick={() => { setDialog("poster"); closeMenu(false); }}>{t("library.changePoster")}</MenuButton>
                <MenuButton onClick={() => { setDialog("summary"); closeMenu(false); }}>{t("library.summaryPreference")}</MenuButton>
                <div className="my-2 h-px bg-[var(--divider)]" />
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("library.heroMenu.maintenance")}</div>
                {onSyncAnime ? (
                  <MenuButton disabled={isSyncing || isLocalSnapshot} onClick={() => { onSyncAnime(); closeMenu(); }}>
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
                      {isSyncing ? t("library.syncing") : t("library.syncAnime")}
                    </span>
                  </MenuButton>
                ) : null}
                {canDiscoverRelatedAnime && onDiscoverRelatedAnime ? (
                  <MenuButton disabled={isDiscoveringSeasons} onClick={() => { onDiscoverRelatedAnime(); closeMenu(); }}>
                    <span className="inline-flex items-center gap-2">
                      {isDiscoveringSeasons ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      {isDiscoveringSeasons ? t("library.tvdbSeasonDiscovering") : t("library.tvdbSeasonDiscovery")}
                    </span>
                  </MenuButton>
                ) : null}
                {onManageManualRelated ? (
                  <MenuButton onClick={() => { onManageManualRelated(); closeMenu(); }}>
                    <span className="block">{t("library.manageManualRelatedAnime")}</span>
                    <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">{t("library.manageManualRelatedAnimeHint")}</span>
                  </MenuButton>
                ) : null}
              </div>
            </div>
          </>,
          document.body,
        ) : null}
      </div>

      <ChoiceDialog open={dialog === "name"} desktop={desktop} title={t("library.changeTitle")} description={t("library.titlePreferenceDescription")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
        <ChoiceButton active={anime.preferredNameId === null} onClick={() => chooseName(null)}>{t("library.defaultPreference")}</ChoiceButton>
        {(anime.availableNames ?? []).map((name) => (
          <ChoiceButton key={name.id} active={anime.preferredNameId === name.id} onClick={() => chooseName(name.id)}>
            {name.name}<span className="text-muted-foreground">{name.language ?? "-"}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "summary"} desktop={desktop} title={t("library.summaryPreference")} description={t("library.summaryPreferenceDescription")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
        <ChoiceButton active={!(anime.availableSummaries ?? []).some((summary) => summary.isPreferred)} onClick={() => chooseSummary(null)}>{t("library.defaultPreference")}</ChoiceButton>
        {(anime.availableSummaries ?? []).map((summary) => (
          <ChoiceButton key={summary.id} active={Boolean(summary.isPreferred)} onClick={() => chooseSummary(summary.id)}>
            <span>{summary.language ?? "-"}</span><span className="line-clamp-2 text-left text-muted-foreground">{summary.summary}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "poster"} desktop={desktop} title={t("library.changePoster")} error={error} restoreFocusRef={triggerRef} onClose={() => setDialog(null)}>
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

function ChoiceDialog({ open, desktop, title, description, error, children, restoreFocusRef, onClose }: { open: boolean; desktop: boolean; title: string; description?: string; error: string | null; children: ReactNode; restoreFocusRef: RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const t = useTranslations();
  const titleId = useId();
  const descriptionId = useId();
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
    <div className={cn("mobile-fixed-below-top-nav fixed inset-0 z-[80] flex justify-center bg-background/88 backdrop-blur-md", desktop ? "items-center p-4" : "items-end p-0")} role="presentation" onClick={onClose}>
      <div ref={dialogRef} className={cn("glass-dialog flex w-full max-w-lg flex-col overflow-hidden border text-foreground", desktop ? "max-h-[calc(var(--app-viewport-height)-2rem)] rounded-[var(--radius-modal)]" : "max-h-[calc(var(--app-viewport-height)-max(1rem,env(safe-area-inset-top)))] rounded-t-[var(--radius-modal)]")} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onClick={(event) => event.stopPropagation()}>
        <div className={cn("flex shrink-0 items-start justify-between gap-3 border-b", desktop ? "p-5" : "p-4")}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" className={cn("shrink-0", desktop ? "h-[38px] w-[38px]" : "h-11 w-11")} data-dialog-close aria-label={t("library.closeChoiceDialog")} onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className={cn("min-h-0 overflow-y-auto overscroll-contain", desktop ? "p-5" : "p-4 pb-[max(1rem,env(safe-area-inset-bottom))]")}>
          <div className="space-y-2" role="radiogroup">{children}</div>
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChoiceButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={active} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]" onClick={onClick}>{children}{active ? <Check className="h-4 w-4" /> : null}</button>;
}
