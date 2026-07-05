"use client";

import { NextIntlClientProvider } from "next-intl";
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { translations, type Locale } from "@/i18n";

const LOCALE_STORAGE_KEY = "ani-tracker-locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const localeListeners = new Set<() => void>();
let currentLocale: Locale = "zh-CN";

function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en";
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "zh-CN";
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(storedLocale)) {
    return storedLocale;
  }

  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function emitLocaleChange() {
  for (const listener of localeListeners) {
    listener();
  }
}

function applyLocale(locale: Locale) {
  currentLocale = locale;

  if (typeof window !== "undefined") {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }

  emitLocaleChange();
}

function subscribeToLocale(listener: () => void) {
  localeListeners.add(listener);

  const initialLocale = getInitialLocale();
  if (initialLocale !== currentLocale) {
    queueMicrotask(() => applyLocale(initialLocale));
  }

  return () => {
    localeListeners.delete(listener);
  };
}

function getLocaleSnapshot() {
  return currentLocale;
}

function getServerLocaleSnapshot() {
  return "zh-CN" as const;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );

  const value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      setLocale: applyLocale,
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <NextIntlClientProvider key={locale} locale={locale} messages={translations[locale]}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function useLocaleControls() {
  const value = useContext(LocaleContext);

  if (!value) {
    throw new Error("useLocaleControls must be used within LocaleProvider");
  }

  return value;
}
