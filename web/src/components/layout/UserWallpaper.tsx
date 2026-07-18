"use client";

/* eslint-disable @next/next/no-img-element -- Private images require the browser's authenticated request. */

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useCurrentUser } from "@/features/auth/hooks";
import type { UserWallpaper as UserWallpaperItem, WallpaperMode } from "@/features/auth/types";
import { getApiUrl } from "@/lib/api-client";

import { useDesktopPlatform } from "./platform-layout";

const DARK_WALLPAPER_LUMINANCE = 0.18;

export function UserWallpaper() {
  const { user } = useCurrentUser();
  const desktop = useDesktopPlatform();
  const activeHasWallpaper = desktop
    ? user?.desktopWallpaperMode !== "default" && Boolean(user?.desktopWallpapers.length)
    : user?.mobileWallpaperMode !== "default" && Boolean(user?.mobileWallpapers.length);
  const glassIntensity = Math.min(Math.max(user?.wallpaperGlassIntensity ?? 50, 0), 100);

  useEffect(() => {
    if (!activeHasWallpaper) delete document.documentElement.dataset.wallpaperTone;
    return () => {
      delete document.documentElement.dataset.wallpaperTone;
    };
  }, [activeHasWallpaper]);

  return (
    <div
      className="user-wallpaper"
      data-glass-style={user?.wallpaperGlassStyle ?? "regular"}
      data-glass-intensity={glassIntensity}
      style={{ "--wallpaper-glass-opacity": glassOpacity(glassIntensity) } as CSSProperties}
      aria-hidden="true"
    >
      {user?.desktopWallpapers.length ? (
        <WallpaperLayer
          key={`desktop:${user.desktopWallpaperMode}:${user.desktopWallpapers.map((item) => item.id).join(",")}`}
          className="user-wallpaper-desktop"
          active={desktop}
          mode={user.desktopWallpaperMode}
          userId={user.id}
          variant="desktop"
          wallpapers={user.desktopWallpapers}
        />
      ) : null}
      {user?.mobileWallpapers.length ? (
        <WallpaperLayer
          key={`mobile:${user.mobileWallpaperMode}:${user.mobileWallpapers.map((item) => item.id).join(",")}`}
          className="user-wallpaper-mobile"
          active={!desktop}
          mode={user.mobileWallpaperMode}
          userId={user.id}
          variant="mobile"
          wallpapers={user.mobileWallpapers}
        />
      ) : null}
    </div>
  );
}

function glassOpacity(intensity: number) {
  return 0.15 + (intensity / 100) * 0.85;
}

function WallpaperLayer({ active, className, mode, userId, variant, wallpapers }: { active: boolean; className: string; mode: WallpaperMode; userId: number; variant: string; wallpapers: UserWallpaperItem[] }) {
  const [failed, setFailed] = useState(false);
  const [randomWallpaper] = useState(() => getSessionWallpaper(userId, variant, wallpapers));
  const imageRef = useRef<HTMLImageElement | null>(null);
  const wallpaper = mode === "default" ? undefined : mode === "random" ? randomWallpaper : wallpapers.find((item) => item.selected) ?? wallpapers[0];

  useEffect(() => {
    if (!active) return;
    function syncTone() {
      const image = imageRef.current;
      if (image?.complete && image.naturalWidth) applyWallpaperTone(image);
    }
    syncTone();
    window.addEventListener("resize", syncTone);
    return () => window.removeEventListener("resize", syncTone);
  }, [active, wallpaper]);

  if (failed || !wallpaper) return null;

  return (
    <div className={`user-wallpaper-variant ${className}`}>
      <img ref={imageRef} className="user-wallpaper-image" src={getApiUrl(wallpaper.url)} crossOrigin="use-credentials" alt="" onLoad={(event) => { if (active) applyWallpaperTone(event.currentTarget); }} onError={() => { setFailed(true); if (active) delete document.documentElement.dataset.wallpaperTone; }} />
      <div className="user-wallpaper-protection" />
    </div>
  );
}

function applyWallpaperTone(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;

  const viewportAspect = window.innerWidth / window.innerHeight;
  const imageAspect = image.naturalWidth / image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (imageAspect > viewportAspect) {
    sourceWidth = image.naturalHeight * viewportAspect;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / viewportAspect;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  try {
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let luminance = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      luminance += 0.2126 * linearChannel(pixels[index] ?? 0) + 0.7152 * linearChannel(pixels[index + 1] ?? 0) + 0.0722 * linearChannel(pixels[index + 2] ?? 0);
    }
    document.documentElement.dataset.wallpaperTone = luminance / (pixels.length / 4) < DARK_WALLPAPER_LUMINANCE ? "dark" : "light";
  } catch {
    delete document.documentElement.dataset.wallpaperTone;
  }
}

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function getSessionWallpaper(userId: number, variant: string, wallpapers: UserWallpaperItem[]) {
  const storageKey = `ani-tracker-random-wallpaper:${userId}:${variant}`;
  const storedId = Number(globalThis.sessionStorage.getItem(storageKey));
  const storedWallpaper = wallpapers.find((item) => item.id === storedId);
  if (storedWallpaper) return storedWallpaper;
  if (wallpapers.length <= 1) {
    const wallpaper = wallpapers[0];
    if (wallpaper) globalThis.sessionStorage.setItem(storageKey, String(wallpaper.id));
    return wallpaper;
  }
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  const wallpaper = wallpapers[(value[0] ?? 0) % wallpapers.length];
  if (wallpaper) globalThis.sessionStorage.setItem(storageKey, String(wallpaper.id));
  return wallpaper;
}
