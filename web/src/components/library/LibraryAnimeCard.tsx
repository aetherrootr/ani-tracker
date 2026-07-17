"use client";

import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/features/library/api";
import type { LibraryItem } from "@/features/library/types";

import { NoPoster } from "./NoPoster";

export function LibraryAnimeCard({ item }: { item: LibraryItem }) {
  const t = useTranslations();
  const locale = useLocale();
  const descriptionId = useId();
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = assetUrl(item.anime.posterUrl);
  const imageFailed = poster !== null && failedPoster === poster;
  const percent = Math.min(Math.max(item.progress.progressPercent ?? 0, 0), 100);
  const total = item.progress.totalEpisodeCount ?? "?";
  const showOriginal = item.anime.originalName && item.anime.originalName !== item.anime.displayName;
  const completed = item.progress.status === "completed";
  const status = t(`library.status.${item.progress.status}`);

  return (
    <article className="library-anime-card app-content-card interactive-card group">
      <Link
        href={`/library/${item.anime.id}`}
        className="library-anime-card-link"
        aria-label={t("library.viewDetails", { title: item.anime.displayName })}
        aria-describedby={descriptionId}
      >
        <div className="library-anime-card-layout">
          <div className="library-anime-poster">
            {poster && !imageFailed ? (
              <Image
                key={poster}
                src={poster}
                alt=""
                fill
                unoptimized
                sizes="(min-width: 1280px) 20vw, (min-width: 768px) 28vw, 104px"
                className="object-cover transition-transform duration-200 group-hover:scale-[1.015] motion-reduce:transition-none"
                onError={() => setFailedPoster(poster)}
              />
            ) : <NoPoster />}
          </div>

          <div className="library-anime-content">
            <div className="min-w-0">
              <h2 className="library-anime-title font-semibold tracking-tight group-hover:underline">{item.anime.displayName}</h2>
              {showOriginal ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.anime.originalName}</p> : null}
            </div>

            <div id={descriptionId} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className={completed ? "gap-1" : undefined}>
                {completed ? <Check className="h-3.5 w-3.5 text-[var(--watched)]" aria-hidden="true" /> : null}
                {status}
              </Badge>
              <span>{t("library.watchedCount", { watched: item.progress.watchedEpisodeCount, total })}</span>
            </div>

            <div className="mt-auto space-y-1.5">
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={t("library.watchProgress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              >
                <div className="h-full rounded-full bg-[var(--watched)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              </div>
              <div className="library-anime-metadata">
                <span>{formatType(item.anime.type, t)}</span>
                <span>{formatProvider(item.anime.provider)} · {formatDate(item.anime.airDate, locale, t("anime.unknown"))}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatProvider(value: string) {
  const labels: Record<string, string> = { anilist: "AniList", tmdb: "TMDB", tvdb: "TVDB" };
  return labels[value.toLowerCase()] ?? value;
}

function formatType(value: string, t: ReturnType<typeof useTranslations>) {
  const key = `library.type.${value.toLowerCase()}`;
  return t.has(key) ? t(key) : value.toUpperCase();
}
