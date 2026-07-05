"use client";

import { useTranslations } from "next-intl";

export default function TrackingListPage() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border bg-card p-5 md:p-8">
        <p className="text-sm font-medium text-muted-foreground">{t("tracking.eyebrow")}</p>
        <div className="mt-3 max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">{t("tracking.title")}</h1>
          <p className="text-muted-foreground md:text-lg">
            {t("tracking.description")}
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-dashed bg-card/50 p-8 text-muted-foreground">
        {t("tracking.placeholder")}
      </section>
    </div>
  );
}
