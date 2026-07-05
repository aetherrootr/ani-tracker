"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useLocaleControls } from "@/i18n/provider";

import { getCurrentUser, login, logout, register, updateLanguagePreference } from "./api";
import type { AuthUser, LoginInput, RegisterInput } from "./types";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  updateLanguagePreference: (input: AuthUser["languagePreference"]) => Promise<AuthUser>;
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

  async function handleUpdateLanguagePreference(languagePreference: AuthUser["languagePreference"]) {
    const response = await updateLanguagePreference({ languagePreference });
    setUser(response.user);
    setLocale(response.user.languagePreference);
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
        updateLanguagePreference: handleUpdateLanguagePreference,
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
