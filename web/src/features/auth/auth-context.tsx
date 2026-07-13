"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useLocaleControls } from "@/i18n/provider";

import { getCurrentUser, login, logout, register, unlinkOidc, updateLanguagePreference, updatePreferences } from "./api";
import type { AuthUser, LoginInput, RegisterInput } from "./types";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  unlinkOidc: () => Promise<AuthUser>;
  updateLanguagePreference: (input: AuthUser["languagePreference"]) => Promise<AuthUser>;
  updateWeekStartDay: (input: number) => Promise<AuthUser>;
  updateImportProviderPreference: (input: string) => Promise<AuthUser>;
  updateIncludeUnwatchedSeasonZeroInTracking: (input: boolean) => Promise<AuthUser>;
  updateIncludeUnwatchedSeasonZeroInStatistics: (input: boolean) => Promise<AuthUser>;
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
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setUser(response.user);
        if (response.user) {
          setLocale(response.user.languagePreference);
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
    setUser(response.user);
    setLocale(response.user.languagePreference);
    setError(null);
    return response.user;
  }

  async function handleRegister(input: RegisterInput) {
    const response = await register(input);
    setUser(response.user);
    setLocale(response.user.languagePreference);
    setError(null);
    return response.user;
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setError(null);
  }

  async function handleUnlinkOidc() {
    const response = await unlinkOidc();
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
        updateImportProviderPreference: handleUpdateImportProviderPreference,
        updateIncludeUnwatchedSeasonZeroInTracking: handleUpdateIncludeUnwatchedSeasonZeroInTracking,
        updateIncludeUnwatchedSeasonZeroInStatistics: handleUpdateIncludeUnwatchedSeasonZeroInStatistics,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
