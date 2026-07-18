"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useLocaleControls } from "@/i18n/provider";

import { getCurrentUser, login, logout, register, removeWallpaper, unlinkOidc, updateLanguagePreference, updatePreferences, updateWallpaperPreferences, uploadWallpaper } from "./api";
import type { AuthUser, LoginInput, RegisterInput, WallpaperGlassAppearanceInput, WallpaperMode, WallpaperVariant } from "./types";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  unlinkOidc: (currentPassword: string) => Promise<AuthUser>;
  updateLanguagePreference: (input: AuthUser["languagePreference"]) => Promise<AuthUser>;
  updateWeekStartDay: (input: number) => Promise<AuthUser>;
  updateTimeZonePreference: (mode: AuthUser["timeZoneMode"], timeZone: string) => Promise<AuthUser>;
  updateImportProviderPreference: (input: string) => Promise<AuthUser>;
  updateIncludeUnwatchedSeasonZeroInTracking: (input: boolean) => Promise<AuthUser>;
  updateIncludeUnwatchedSeasonZeroInStatistics: (input: boolean) => Promise<AuthUser>;
  updateShareWallpapersOnLogin: (input: boolean) => Promise<AuthUser>;
  updateWallpaperGlassAppearance: (input: WallpaperGlassAppearanceInput) => Promise<AuthUser>;
  uploadWallpaper: (variant: WallpaperVariant, file: File) => Promise<AuthUser>;
  removeWallpaper: (variant: WallpaperVariant, wallpaperId: number) => Promise<AuthUser>;
  updateWallpaperPreferences: (variant: WallpaperVariant, mode: WallpaperMode, selectedWallpaperId?: number) => Promise<AuthUser>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLocale } = useLocaleControls();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    getCurrentUser()
      .then(async (response) => {
        if (!isMounted) {
          return;
        }

        const nextUser = response.user ? await syncAutomaticTimeZone(response.user) : null;
        if (!isMounted) return;
        setUser(nextUser);
        if (nextUser) {
          setLocale(nextUser.languagePreference);
        }
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (!isMounted) {
          return;
        }

        setUser(null);
        setError(caughtError instanceof Error ? caughtError : new Error("Failed to load current user"));
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [setLocale]);

  async function handleLogin(input: LoginInput) {
    const response = await login(input);
    const nextUser = await syncAutomaticTimeZone(response.user);
    setUser(nextUser);
    setLocale(nextUser.languagePreference);
    setError(null);
    return nextUser;
  }

  async function handleRegister(input: RegisterInput) {
    const response = await register(input);
    const nextUser = await syncAutomaticTimeZone(response.user);
    setUser(nextUser);
    setLocale(nextUser.languagePreference);
    setError(null);
    return nextUser;
  }

  async function handleLogout() {
    await logout();
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("ani-tracker-random-wallpaper:")) sessionStorage.removeItem(key);
    }
    setUser(null);
    setError(null);
  }

  async function handleUnlinkOidc(currentPassword: string) {
    const response = await unlinkOidc(currentPassword);
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateLanguagePreference(languagePreference: AuthUser["languagePreference"]) {
    const response = await updateLanguagePreference({ languagePreference });
    setUser(response.user);
    setLocale(response.user.languagePreference);
    setError(null);
    return response.user;
  }

  async function handleUpdateWeekStartDay(weekStartDay: number) {
    const response = await updatePreferences({ weekStartDay });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateTimeZonePreference(timeZoneMode: AuthUser["timeZoneMode"], timeZone: string) {
    const response = await updatePreferences({ timeZoneMode, timeZone });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateImportProviderPreference(importProviderPreference: string) {
    const response = await updatePreferences({ importProviderPreference });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateIncludeUnwatchedSeasonZeroInTracking(includeUnwatchedSeasonZeroInTracking: boolean) {
    const response = await updatePreferences({ includeUnwatchedSeasonZeroInTracking });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateIncludeUnwatchedSeasonZeroInStatistics(includeUnwatchedSeasonZeroInStatistics: boolean) {
    const response = await updatePreferences({ includeUnwatchedSeasonZeroInStatistics });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateShareWallpapersOnLogin(shareWallpapersOnLogin: boolean) {
    const response = await updatePreferences({ shareWallpapersOnLogin });
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateWallpaperGlassAppearance(input: WallpaperGlassAppearanceInput) {
    const response = await updatePreferences(input);
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUploadWallpaper(variant: WallpaperVariant, file: File) {
    const response = await uploadWallpaper(variant, file);
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleRemoveWallpaper(variant: WallpaperVariant, wallpaperId: number) {
    const response = await removeWallpaper(variant, wallpaperId);
    setUser(response.user);
    setError(null);
    return response.user;
  }

  async function handleUpdateWallpaperPreferences(variant: WallpaperVariant, mode: WallpaperMode, selectedWallpaperId?: number) {
    const response = await updateWallpaperPreferences(variant, mode, selectedWallpaperId);
    setUser(response.user);
    setError(null);
    return response.user;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        login: handleLogin,
        register: handleRegister,
        logout: handleLogout,
        unlinkOidc: handleUnlinkOidc,
        updateLanguagePreference: handleUpdateLanguagePreference,
        updateWeekStartDay: handleUpdateWeekStartDay,
        updateTimeZonePreference: handleUpdateTimeZonePreference,
        updateImportProviderPreference: handleUpdateImportProviderPreference,
        updateIncludeUnwatchedSeasonZeroInTracking: handleUpdateIncludeUnwatchedSeasonZeroInTracking,
        updateIncludeUnwatchedSeasonZeroInStatistics: handleUpdateIncludeUnwatchedSeasonZeroInStatistics,
        updateShareWallpapersOnLogin: handleUpdateShareWallpapersOnLogin,
        updateWallpaperGlassAppearance: handleUpdateWallpaperGlassAppearance,
        uploadWallpaper: handleUploadWallpaper,
        removeWallpaper: handleRemoveWallpaper,
        updateWallpaperPreferences: handleUpdateWallpaperPreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

async function syncAutomaticTimeZone(user: AuthUser) {
  if (user.timeZoneMode !== "auto" || typeof Intl === "undefined") return user;
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!browserTimeZone || browserTimeZone === user.timeZone) return user;
  try {
    return (await updatePreferences({ timeZone: browserTimeZone, timeZoneMode: "auto" })).user;
  } catch {
    return user;
  }
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
