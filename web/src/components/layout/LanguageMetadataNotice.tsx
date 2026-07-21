"use client";

import { Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

const NOTICE_STORAGE_KEY = "ani-tracker-language-metadata-notice";

export function queueLanguageMetadataNotice() {
  sessionStorage.setItem(NOTICE_STORAGE_KEY, "true");
}

export function clearQueuedLanguageMetadataNotice() {
  sessionStorage.removeItem(NOTICE_STORAGE_KEY);
}

export function LanguageMetadataNotice() {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(NOTICE_STORAGE_KEY) !== "true") return;
    sessionStorage.removeItem(NOTICE_STORAGE_KEY);
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[110] flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border bg-[var(--surface-solid)] p-4 text-foreground shadow-[var(--shadow-medium)]" role="status" aria-live="polite">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("app.languageMetadataNoticeTitle")}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("app.languageMetadataNoticeDescription")}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0" aria-label={t("app.dismissLanguageMetadataNotice")} onClick={() => setVisible(false)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
