"use client";

/* eslint-disable @next/next/no-img-element -- Private previews require the browser's authenticated request. */

import { Check, CheckCircle2, Monitor, Smartphone, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SlidingOptionGroup } from "@/components/ui/sliding-option-group";
import { useCurrentUser, useUpdateShareWallpapersOnLogin, useUpdateWallpaperGlassAppearance, useWallpaperActions } from "@/features/auth/hooks";
import type { UserWallpaper, WallpaperGlassStyle, WallpaperMode, WallpaperVariant } from "@/features/auth/types";
import { getApiUrl } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MODE_OPTIONS = ["default", "fixed", "random"] as const;
const GLASS_STYLE_OPTIONS = ["clear", "regular", "frosted"] as const;

export function WallpaperSettingsCard() {
  const t = useTranslations();
  const { user } = useCurrentUser();
  const updateShareWallpapersOnLogin = useUpdateShareWallpapersOnLogin();
  const uploadedCount = (user?.desktopWallpapers.length ?? 0) + (user?.mobileWallpapers.length ?? 0);
  const uploadLimit = user?.wallpaperUploadLimit ?? 0;
  const [isSavingSharing, setIsSavingSharing] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  async function handleSharingChange(checked: boolean) {
    setIsSavingSharing(true);
    setSharingError(null);
    try {
      await updateShareWallpapersOnLogin(checked);
    } catch {
      setSharingError(t("settings.wallpaper.loginSharingFailed"));
    } finally {
      setIsSavingSharing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{t("settings.wallpaper.title")}</CardTitle>
          <Badge variant="warning">{t("settings.wallpaper.beta")}</Badge>
        </div>
        <p className="text-sm font-normal leading-6 text-muted-foreground">{t("settings.wallpaper.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>{t("settings.wallpaper.capacity", { count: uploadedCount, limit: uploadLimit })}</span>
          <span>{t("settings.wallpaper.sharedLimit")}</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <WallpaperCollection variant="desktop" icon={Monitor} uploadedCount={uploadedCount} uploadLimit={uploadLimit} />
          <WallpaperCollection variant="mobile" icon={Smartphone} uploadedCount={uploadedCount} uploadLimit={uploadLimit} />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("settings.wallpaper.help")}</p>
        <WallpaperAppearanceControls
          key={`${user?.wallpaperGlassStyle ?? "regular"}:${user?.wallpaperGlassIntensity ?? 50}`}
          initialStyle={user?.wallpaperGlassStyle ?? "regular"}
          initialIntensity={user?.wallpaperGlassIntensity ?? 50}
        />
        <div className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border bg-[var(--ambient)] p-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{t("settings.wallpaper.loginSharingTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("settings.wallpaper.loginSharingDescription")}</p>
            {sharingError ? <p role="alert" className="mt-2 text-sm text-destructive">{sharingError}</p> : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-label={t("settings.wallpaper.loginSharingTitle")}
            aria-checked={user?.shareWallpapersOnLogin ?? false}
            disabled={isSavingSharing}
            className="settings-switch flex-none"
            onClick={() => void handleSharingChange(!(user?.shareWallpapersOnLogin ?? false))}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function WallpaperAppearanceControls({ initialStyle, initialIntensity }: { initialStyle: WallpaperGlassStyle; initialIntensity: number }) {
  const t = useTranslations();
  const updateWallpaperGlassAppearance = useUpdateWallpaperGlassAppearance();
  const [glassStyle, setGlassStyle] = useState(initialStyle);
  const [glassIntensity, setGlassIntensity] = useState(initialIntensity);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const persistedIntensityRef = useRef(initialIntensity);
  const savingRef = useRef(false);

  async function handleStyleChange(nextStyle: WallpaperGlassStyle) {
    if (savingRef.current) return;
    const previousStyle = glassStyle;
    setGlassStyle(nextStyle);
    previewWallpaperGlass({ style: nextStyle });
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await updateWallpaperGlassAppearance({ wallpaperGlassStyle: nextStyle });
    } catch {
      setGlassStyle(previousStyle);
      previewWallpaperGlass({ style: previousStyle });
      setError(t("settings.wallpaper.appearanceFailed"));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  function previewIntensity(nextIntensity: number) {
    setGlassIntensity(nextIntensity);
    previewWallpaperGlass({ intensity: nextIntensity });
  }

  async function commitIntensity(nextIntensity: number) {
    if (savingRef.current || nextIntensity === persistedIntensityRef.current) return;
    const previousIntensity = persistedIntensityRef.current;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await updateWallpaperGlassAppearance({ wallpaperGlassIntensity: nextIntensity });
      persistedIntensityRef.current = nextIntensity;
    } catch {
      setGlassIntensity(previousIntensity);
      previewWallpaperGlass({ intensity: previousIntensity });
      setError(t("settings.wallpaper.appearanceFailed"));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-[var(--radius-card)] border bg-[var(--ambient)] p-4" aria-labelledby="wallpaper-glass-appearance-title" aria-busy={isSaving}>
      <div>
        <h3 id="wallpaper-glass-appearance-title" className="font-semibold text-foreground">{t("settings.wallpaper.appearanceTitle")}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("settings.wallpaper.appearanceDescription")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t("settings.wallpaper.styleLabel")}</p>
          <SlidingOptionGroup ariaLabel={t("settings.wallpaper.styleLabel")} options={GLASS_STYLE_OPTIONS} value={glassStyle} render={(value) => t(`settings.wallpaper.styles.${value}`)} onChange={(value) => void handleStyleChange(value)} className="max-w-md" disabled={isSaving} />
          <p className="text-xs leading-5 text-muted-foreground">{t(`settings.wallpaper.styleDescriptions.${glassStyle}`)}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="wallpaper-glass-intensity" className="text-sm font-medium text-foreground">{t("settings.wallpaper.intensityLabel")}</label>
            <output htmlFor="wallpaper-glass-intensity" className="min-w-12 rounded-full border bg-[var(--surface-card)] px-2.5 py-1 text-center text-sm font-semibold tabular-nums text-foreground">{glassIntensity}</output>
          </div>
          <input
            id="wallpaper-glass-intensity"
            type="range"
            min={0}
            max={100}
            step={1}
            value={glassIntensity}
            disabled={isSaving}
            aria-valuetext={t("settings.wallpaper.intensityValue", { value: glassIntensity })}
            className="wallpaper-glass-intensity-slider"
            onChange={(event) => previewIntensity(Number(event.currentTarget.value))}
            onPointerUp={(event) => void commitIntensity(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) void commitIntensity(Number(event.currentTarget.value));
            }}
            onBlur={(event) => void commitIntensity(Number(event.currentTarget.value))}
          />
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
          <p className="text-xs leading-5 text-muted-foreground">{t("settings.wallpaper.intensityDescription")}</p>
        </div>
      </div>
      {isSaving ? <p role="status" className="text-xs text-muted-foreground">{t("settings.wallpaper.appearanceSaving")}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function previewWallpaperGlass({ style, intensity }: { style?: WallpaperGlassStyle; intensity?: number }) {
  const wallpaper = document.querySelector<HTMLElement>(".user-wallpaper");
  if (!wallpaper) return;
  if (style) wallpaper.dataset.glassStyle = style;
  if (intensity !== undefined) {
    wallpaper.dataset.glassIntensity = String(intensity);
    wallpaper.style.setProperty("--wallpaper-glass-opacity", String(0.15 + (intensity / 100) * 0.85));
  }
}

function WallpaperCollection({ variant, icon: Icon, uploadedCount, uploadLimit }: { variant: WallpaperVariant; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; uploadedCount: number; uploadLimit: number }) {
  const t = useTranslations();
  const { user } = useCurrentUser();
  const { uploadWallpaper, removeWallpaper, updateWallpaperPreferences } = useWallpaperActions();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallpapers = variant === "desktop" ? user?.desktopWallpapers ?? [] : user?.mobileWallpapers ?? [];
  const mode = variant === "desktop" ? user?.desktopWallpaperMode ?? "fixed" : user?.mobileWallpaperMode ?? "fixed";

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.some((file) => file.size > MAX_FILE_SIZE)) {
      setError(t("settings.wallpaper.fileTooLarge"));
      clearInput();
      return;
    }
    if (uploadedCount + selectedFiles.length > uploadLimit) {
      setError(t("settings.wallpaper.limitReached", { limit: uploadLimit }));
      clearInput();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      for (const file of selectedFiles) await uploadWallpaper(variant, file);
    } catch {
      setError(t("settings.wallpaper.uploadFailed"));
    } finally {
      setIsSaving(false);
      clearInput();
    }
  }

  async function handleModeChange(nextMode: WallpaperMode) {
    setIsSaving(true);
    setError(null);
    try {
      await updateWallpaperPreferences(variant, nextMode, wallpapers.find((item) => item.selected)?.id);
    } catch {
      setError(t("settings.wallpaper.preferenceFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function selectWallpaper(wallpaper: UserWallpaper) {
    setIsSaving(true);
    setError(null);
    try {
      await updateWallpaperPreferences(variant, "fixed", wallpaper.id);
    } catch {
      setError(t("settings.wallpaper.preferenceFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteWallpaper(wallpaperId: number) {
    setIsSaving(true);
    setError(null);
    try {
      await removeWallpaper(variant, wallpaperId);
    } catch {
      setError(t("settings.wallpaper.deleteFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  function clearInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border bg-[var(--surface-card)]" aria-labelledby={`${variant}-wallpaper-title`}>
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[var(--radius-control)] bg-[var(--accent-soft)] text-[var(--accent-solid)]"><Icon className="h-5 w-5" aria-hidden={true} /></span>
          <div>
            <h3 id={`${variant}-wallpaper-title`} className="font-semibold text-foreground">{t(`settings.wallpaper.${variant}`)}</h3>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{t(`settings.wallpaper.${variant}Description`)}</p>
          </div>
        </div>

        <fieldset className={cn("grid gap-2 sm:grid-cols-3", isSaving && "opacity-60")} disabled={isSaving}>
          <legend className="sr-only">{t("settings.wallpaper.modeLabel")}</legend>
          {MODE_OPTIONS.map((option) => {
            const selected = mode === option;
            return (
              <label
                key={option}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border bg-background/65 px-3 py-2.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-[var(--surface-hover)] has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent-glow)]",
                  selected && "border-[color-mix(in_srgb,var(--accent-solid)_42%,var(--border))] bg-[var(--accent-soft)]",
                  isSaving && "cursor-not-allowed",
                )}
              >
                <input className="sr-only" type="radio" name={`${variant}-wallpaper-mode`} value={option} checked={selected} onChange={() => void handleModeChange(option)} />
                <span>{t(`settings.wallpaper.modes.${option}`)}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-[var(--accent-solid)]" aria-hidden="true" /> : null}
              </label>
            );
          })}
        </fieldset>
        <p className="text-xs leading-5 text-muted-foreground">{t(`settings.wallpaper.${mode}Description`)}</p>

        {wallpapers.length ? (
          <div className="wallpaper-gallery">
            {wallpapers.map((wallpaper, index) => (
              <div key={wallpaper.id} className={`wallpaper-gallery-item ${mode === "fixed" && wallpaper.selected ? "is-selected" : ""}`}>
                <button type="button" className="wallpaper-gallery-select" aria-label={t("settings.wallpaper.useImage", { number: index + 1 })} aria-pressed={mode === "fixed" && wallpaper.selected} disabled={isSaving} onClick={() => void selectWallpaper(wallpaper)}>
                  <img src={getApiUrl(wallpaper.url)} alt="" />
                  {mode === "fixed" && wallpaper.selected ? <span className="wallpaper-gallery-check"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span> : null}
                </button>
                <button type="button" className="wallpaper-gallery-delete" aria-label={t("settings.wallpaper.deleteImage", { number: index + 1 })} disabled={isSaving} onClick={() => void deleteWallpaper(wallpaper.id)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        ) : <div className="wallpaper-empty"><Icon className="h-7 w-7" aria-hidden={true} /><span>{t("settings.wallpaper.empty")}</span></div>}

        <input ref={inputRef} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label={t(`settings.wallpaper.choose${variant === "desktop" ? "Desktop" : "Mobile"}`)} disabled={isSaving || uploadedCount >= uploadLimit} onChange={(event) => void handleFiles(event.target.files)} />
        <Button type="button" variant="outline" className="min-h-11" disabled={isSaving || uploadedCount >= uploadLimit} onClick={() => inputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{isSaving ? t("settings.wallpaper.saving") : t("settings.wallpaper.addImages")}</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}
