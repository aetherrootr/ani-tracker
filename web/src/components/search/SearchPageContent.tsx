"use client";

import { ArrowUp, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAnimeSearch } from "@/features/search/hooks";

import { SearchResultCard } from "./SearchResultCard";
import { SearchState } from "./SearchState";

export function SearchPageContent() {
  const {
    keyword,
    hasKeyword,
    results,
    total,
    isLoading,
    isLoadingMore,
    error,
    paginationError,
    hasMore,
    updateKeyword,
    loadMore,
    retrySearch,
  } = useAnimeSearch();
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const canAutoLoadRef = useRef(true);
  const restoreScrollYRef = useRef<number | null>(null);

  useEffect(() => {
    canAutoLoadRef.current = true;
  }, [keyword]);

  useEffect(() => {
    if (!isProviderDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProviderDialogOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderDialogOpen]);

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(window.scrollY > 360);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useLayoutEffect(() => {
    if (restoreScrollYRef.current === null) {
      return;
    }

    window.scrollTo({ top: restoreScrollYRef.current });
    restoreScrollYRef.current = null;
  }, [results.length]);

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;

    if (!loadMoreElement || !hasMore || isLoading || isLoadingMore || error || paginationError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry) {
          return;
        }

        if (!entry.isIntersecting) {
          canAutoLoadRef.current = true;
          return;
        }

        if (canAutoLoadRef.current) {
          canAutoLoadRef.current = false;
          restoreScrollYRef.current = window.scrollY;
          loadMore();
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [error, hasMore, isLoading, isLoadingMore, loadMore, paginationError]);

  function handleImageError(imageUrl: string) {
    setFailedImageUrls((current) => new Set(current).add(imageUrl));
  }

  function handleSearchAction() {
    if (paginationError) {
      handleLoadMore();
      return;
    }

    retrySearch();
  }

  function handleLoadMore() {
    restoreScrollYRef.current = window.scrollY;
    loadMore();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">搜索动画</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            搜索
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="md:hidden">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-2 rounded-full px-3"
              onClick={() => setIsProviderDialogOpen(true)}
            >
              Provider
              <Badge variant="secondary">bangumi</Badge>
            </Button>
          </div>

          <div className="flex items-end gap-2 md:gap-4">
            <div className="hidden space-y-2 md:block md:w-48">
              <Label>Provider</Label>
              <div className="flex h-12 items-center rounded-md border bg-muted/40 px-2 md:px-3">
                <Badge variant="secondary">bangumi</Badge>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="anime-search"
                  value={keyword}
                  onChange={(event) => updateKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSearchAction();
                    }
                  }}
                  placeholder="搜索动画，例如 孤独摇滚"
                  className="h-12 pl-9 text-base"
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                className="h-12 px-3 md:px-5"
                disabled={!hasKeyword || isLoading || isLoadingMore}
                onClick={handleSearchAction}
              >
                {error || paginationError ? "重试" : "搜索"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isProviderDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-background/80 p-4 backdrop-blur-sm md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-dialog-title"
          onClick={() => setIsProviderDialogOpen(false)}
        >
          <div
            className="w-full rounded-2xl border bg-card p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="provider-dialog-title" className="font-semibold tracking-tight">
                  选择 Provider
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭 provider 设置"
                onClick={() => setIsProviderDialogOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <button
              type="button"
              className="mt-4 flex w-full items-center justify-between rounded-xl border bg-muted/40 px-4 py-3 text-left"
              onClick={() => setIsProviderDialogOpen(false)}
            >
              <span className="font-medium">bangumi</span>
              <Badge variant="secondary">当前使用</Badge>
            </button>
          </div>
        </div>
      ) : null}

      <SearchState
        hasKeyword={hasKeyword}
        error={error}
        isLoading={isLoading}
        total={total}
        resultCount={results.length}
      />

      {results.length > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-4">
            {results.map((result) => (
              <SearchResultCard
                key={`${result.provider}:${result.externalId}`}
                result={result}
                imageFailed={Boolean(
                  result.imageUrl && failedImageUrls.has(result.imageUrl),
                )}
                onImageError={handleImageError}
              />
            ))}
          </div>

          <div ref={loadMoreRef} className="min-h-1" />

          {isLoadingMore ? (
            <div className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">
              加载更多中...
            </div>
          ) : null}

          {paginationError ? (
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{paginationError}</span>
              <Button type="button" variant="outline" size="sm" onClick={handleLoadMore}>
                重试加载
              </Button>
            </div>
          ) : null}

          {!hasMore && !isLoadingMore ? (
            <div className="text-center text-sm text-muted-foreground">已加载全部结果</div>
          ) : null}
        </div>
      ) : null}

      {showBackToTop ? (
        <Button
          type="button"
          size="icon"
          className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg"
          aria-label="回到页面开头"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
