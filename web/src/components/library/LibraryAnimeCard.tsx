"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/features/library/api";
import type { LibraryItem } from "@/features/library/types";

import { NoPoster } from "./NoPoster";

export function LibraryAnimeCard({ item }: { item: LibraryItem }) {
  const t = useTranslations();
  const [imageFailed, setImageFailed] = useState(false);
  const poster = assetUrl(item.anime.posterUrl);
  const percent = item.progress.progressPercent ?? 0;
  const total = item.progress.totalEpisodeCount ?? "?";
  const showOriginal = item.anime.originalName && item.anime.originalName !== item.anime.displayName;

  return (
    <article className="group h-full overflow-hidden rounded-2xl border bg-card shadow-sm transition-transform motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:flex sm:flex-col">
      <Link href={`/library/${item.anime.id}`} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex h-full gap-4 p-3 sm:block sm:p-0">
          <div className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-full sm:rounded-none">
            {poster && !imageFailed ? (
              <Image
                src={poster}
                alt={t("anime.coverAlt", { title: item.anime.displayName })}
                fill
                unoptimized
                sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 112px"
                className="object-cover opacity-0 transition-opacity duration-300 motion-reduce:transition-none"
                onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <NoPoster />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col space-y-3 sm:p-4">
            <div className="min-w-0">
              <h2 className="line-clamp-2 min-h-[2.5rem] font-semibold leading-tight tracking-tight group-hover:underline">
                {item.anime.displayName}
              </h2>
              <p className="mt-1 min-h-4 line-clamp-1 text-xs text-muted-foreground">
                {showOriginal ? item.anime.originalName : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{t(`library.status.${item.progress.status}`)}</Badge>
              <span>{item.progress.watchedEpisodeCount} / {total}</span>
            </div>

            <div className="mt-auto space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{item.anime.type}</span>
                <span>{item.anime.provider} · {formatDate(item.anime.airDate, t("anime.unknown"))}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}

function formatDate(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }
  return value.slice(0, 10);
}
