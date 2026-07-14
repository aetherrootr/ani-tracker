"use client";

import Image from "next/image";
import { Check, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { assetUrl, updateAnimeNamePreference, updatePosterPreference, updateSummaryPreference } from "@/features/library/api";
import type { Anime } from "@/features/library/types";
import { cn } from "@/lib/utils";

import { NoPoster } from "./NoPoster";

type Dialog = "name" | "poster" | "summary" | null;

export function AnimeHeroSettingsMenu({ anime, onAnimeChange }: { anime: Anime; onAnimeChange: (anime: Anime) => void }) {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="relative z-20 shrink-0">
        <Button type="button" variant="secondary" size="icon" className="rounded-full bg-background/70 backdrop-blur" aria-label={t("library.heroSettings")} aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}>
          <Settings className="h-4 w-4" />
        </Button>
        {menuOpen ? (
          <div className="glass-dialog absolute right-0 top-12 w-48 rounded-2xl border p-2 text-sm text-foreground">
            <MenuButton onClick={() => { setDialog("name"); setMenuOpen(false); }}>{t("library.changeTitle")}</MenuButton>
            <MenuButton onClick={() => { setDialog("poster"); setMenuOpen(false); }}>{t("library.changePoster")}</MenuButton>
            <MenuButton onClick={() => { setDialog("summary"); setMenuOpen(false); }}>{t("library.summaryPreference")}</MenuButton>
          </div>
        ) : null}
      </div>

      <ChoiceDialog open={dialog === "name"} title={t("library.changeTitle")} error={error} onClose={() => setDialog(null)}>
        <ChoiceButton active={anime.preferredNameId === null} onClick={() => chooseName(null)}>{anime.originalName}</ChoiceButton>
        {(anime.availableNames ?? []).map((name) => (
          <ChoiceButton key={name.id} active={anime.preferredNameId === name.id} onClick={() => chooseName(name.id)}>
            {name.name}<span className="text-muted-foreground">{name.language ?? "-"}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "summary"} title={t("library.summaryPreference")} error={error} onClose={() => setDialog(null)}>
        <ChoiceButton active={false} onClick={() => chooseSummary(null)}>{t("library.defaultPreference")}</ChoiceButton>
        {(anime.availableSummaries ?? []).map((summary) => (
          <ChoiceButton key={summary.id} active={anime.summary?.id === summary.id} onClick={() => chooseSummary(summary.id)}>
            <span>{summary.language ?? "-"}</span><span className="line-clamp-2 text-left text-muted-foreground">{summary.summary}</span>
          </ChoiceButton>
        ))}
      </ChoiceDialog>

      <ChoiceDialog open={dialog === "poster"} title={t("library.changePoster")} error={error} onClose={() => setDialog(null)}>
        <div className="grid grid-cols-3 gap-3">
          {(anime.availablePosters ?? []).map((poster) => {
            const url = assetUrl(poster.url);
            return (
              <button key={poster.id} type="button" className={cn("overflow-hidden rounded-xl border p-1 text-left", (anime.preferredPosterId === poster.id || poster.isPreferred) && "ring-2 ring-primary", poster.status !== "ready" && "opacity-45")} onClick={() => choosePoster(poster.id)}>
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted">
                  {url ? <Image src={url} alt="" fill unoptimized sizes="120px" className="object-cover" /> : <NoPoster />}
                </div>
                <div className="mt-1 text-center text-[11px] text-muted-foreground">{poster.status}</div>
              </button>
            );
          })}
        </div>
      </ChoiceDialog>
    </>
  );
}

function MenuButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="block w-full rounded-xl px-3 py-2 text-left hover:bg-accent" onClick={onClick}>{children}</button>;
}

function ChoiceDialog({ open, title, error, children, onClose }: { open: boolean; title: string; error: string | null; children: ReactNode; onClose: () => void }) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="mobile-fixed-below-top-nav fixed inset-0 z-[80] flex items-center justify-center bg-background/88 p-4 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="glass-dialog max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 text-foreground">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-2">{children}</div>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

function ChoiceButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className="flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left hover:bg-accent" onClick={onClick}>{children}{active ? <Check className="h-4 w-4" /> : null}</button>;
}
