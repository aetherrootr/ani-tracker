"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const DISMISS_STORAGE_KEY = "ani-tracker-pwa-install-dismissed-at";
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaInstallPrompt() {
  const t = useTranslations();
  const installEventRef = useRef<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"ios" | "native" | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isInstalled() || wasRecentlyDismissed() || !window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;

    let revealTimer: number | undefined;
    function reveal(nextMode: "ios" | "native") {
      window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(() => {
        setMode(nextMode);
        setVisible(true);
      }, 1200);
    }
    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      installEventRef.current = event as InstallPromptEvent;
      reveal("native");
    }
    function handleInstalled() {
      installEventRef.current = null;
      setVisible(false);
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    if (isIOS()) reveal("ios");

    return () => {
      window.clearTimeout(revealTimer);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // Storage can be unavailable in private browsing.
    }
    setVisible(false);
  }

  async function install() {
    const event = installEventRef.current;
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    installEventRef.current = null;
    if (choice.outcome === "dismissed") dismiss();
    else setVisible(false);
  }

  if (!visible || !mode) return null;

  return (
    <aside
      className="glass-dialog fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[var(--z-popover)] mx-auto w-auto max-w-md rounded-2xl border p-4 text-foreground shadow-[var(--shadow-high)]"
      aria-label={t("app.install.title")}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-solid)]" aria-hidden="true">
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("app.install.title")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("app.install.description")}</p>
        </div>
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11 shrink-0" onClick={dismiss} aria-label={t("app.install.dismiss")}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {mode === "ios" ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border bg-[var(--surface-glass-subtle)] px-3 py-2.5 text-sm">
          <Share className="h-5 w-5 shrink-0 text-[var(--accent-solid)]" aria-hidden="true" />
          <span>{t("app.install.iosShare")}</span>
          <SquarePlus className="ml-auto h-5 w-5 shrink-0 text-[var(--accent-solid)]" aria-hidden="true" />
          <span className="font-medium">{t("app.install.iosAdd")}</span>
        </div>
      ) : (
        <Button type="button" className="mt-4 min-h-11 w-full" onClick={() => void install()}>
          <Download className="h-4 w-4" />
          {t("app.install.action")}
        </Button>
      )}
    </aside>
  );
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISS_STORAGE_KEY));
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}
