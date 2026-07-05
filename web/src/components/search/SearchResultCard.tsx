import { ChevronDown, ChevronRight, ExternalLink, ImageOff } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AnimeSearchResult } from "@/features/search/types";

type SearchResultCardProps = {
  result: AnimeSearchResult;
  imageFailed: boolean;
  onImageError: (imageUrl: string) => void;
};

export function SearchResultCard({ result, imageFailed, onImageError }: SearchResultCardProps) {
  const hasImage = result.imageUrl && !imageFailed;
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Card className="overflow-hidden">
      <CardContent className="grid grid-cols-[72px_1fr] gap-3 p-3 sm:grid-cols-[128px_1fr] sm:gap-4 sm:p-4 md:p-5">
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground sm:h-44 sm:rounded-xl">
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.imageUrl ?? undefined}
              alt={`${result.title} 封面`}
              className="h-full w-full object-cover"
              onError={() => result.imageUrl && onImageError(result.imageUrl)}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-[10px] sm:gap-2 sm:text-xs">
              <ImageOff className="h-5 w-5 sm:h-6 sm:w-6" />
              无封面
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2 sm:space-y-3">
          <div className="space-y-1">
            <h2 className="line-clamp-1 text-sm font-semibold tracking-tight sm:line-clamp-2 sm:text-xl">
              {result.title}
            </h2>
            {result.originalTitle ? (
              <p className="line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                原名：{result.originalTitle}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <button
                type="button"
                className="group relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label={showDetails ? "收起详情" : "展开详情"}
                onClick={() => setShowDetails((current) => !current)}
              >
                {showDetails ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                  {showDetails ? "收起详情" : "展开详情"}
                </span>
              </button>
              {!showDetails ? (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Badge variant="outline">{result.provider}</Badge>
                  {result.platform ? <Badge variant="secondary">{result.platform}</Badge> : null}
                  {result.episodeCount !== null ? (
                    <Badge variant="secondary">{result.episodeCount} 集</Badge>
                  ) : null}
                  {result.airDate ? <Badge variant="secondary">{result.airDate}</Badge> : null}
                </div>
              ) : null}
            </div>

            {showDetails ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border bg-muted/30 p-2 text-xs sm:gap-2 sm:rounded-xl sm:p-3 sm:text-sm lg:grid-cols-3">
                <SearchResultDetail label="Provider" value={result.provider} />
                <SearchResultDetail label="外部 ID" value={result.externalId} />
                <SearchResultDetail label="剧集类型" value={result.platform} />
                <SearchResultDetail
                  label="集数"
                  value={result.episodeCount !== null ? `${result.episodeCount} 集` : null}
                />
                <SearchResultDetail label="开播时间" value={result.airDate} />
              </div>
            ) : null}
          </div>

          {result.summary ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-3 sm:text-sm sm:leading-6">
              {result.summary}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground sm:text-sm">暂无简介</p>
          )}

          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline sm:text-sm"
          >
            在 {result.provider} 查看
            <ExternalLink className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function SearchResultDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 space-y-0.5 sm:space-y-1">
      <div className="text-[10px] text-muted-foreground sm:text-xs">{label}</div>
      <div className="truncate font-medium">{value ?? "未知"}</div>
    </div>
  );
}
