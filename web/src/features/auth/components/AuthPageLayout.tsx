"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import type { TranslationKey } from "@/i18n";

type AuthPageLayoutProps = {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  children: ReactNode;
};

export function AuthPageLayout({ titleKey, descriptionKey, children }: AuthPageLayoutProps) {
  const t = useTranslations();

  return (
    <div className="min-h-screen bg-background px-6 py-10 md:flex md:items-center md:justify-center md:py-12">
      <div className="w-full md:max-w-md md:rounded-2xl md:border md:bg-card md:p-6 md:shadow-md">
        <div className="mb-6 flex justify-end md:-mb-2">
          <LanguageToggle />
        </div>
        <div className="mb-10 text-left md:mb-6 md:text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground md:mx-auto">
            A
          </div>
          <p className="mt-5 text-sm font-medium text-muted-foreground md:mt-4">Ani Tracker</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-2xl">{t(titleKey)}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground md:mt-2">{t(descriptionKey)}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
