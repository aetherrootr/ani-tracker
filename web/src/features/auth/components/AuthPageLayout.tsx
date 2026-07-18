"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { AppLogoMark } from "@/components/ui/app-logo-mark";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TranslationKey } from "@/i18n";

import { AuthWallpaper } from "./AuthWallpaper";

type AuthPageLayoutProps = {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  children: ReactNode;
  showSharedWallpaper?: boolean;
};

export function AuthPageLayout({ titleKey, descriptionKey, children, showSharedWallpaper = false }: AuthPageLayoutProps) {
  const t = useTranslations();

  return (
    <ScrollArea ariaLabel={t("app.scrollableContent")} className="auth-scroll-area" viewportAs="main" viewportClassName="auth-page">
      {showSharedWallpaper ? <AuthWallpaper /> : null}
      <div className="auth-surface glass-dialog">
        <div className="auth-language">
          <LanguageToggle />
        </div>
        <div className="auth-brand">
          <AppLogoMark className="auth-logo h-12 w-12" />
          <div>
            <p className="auth-product text-sm font-medium text-muted-foreground">Ani Tracker</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t(titleKey)}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t(descriptionKey)}</p>
          </div>
        </div>
        <div className="auth-form">{children}</div>
      </div>
    </ScrollArea>
  );
}
