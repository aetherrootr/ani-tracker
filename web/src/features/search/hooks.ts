"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { searchAnime } from "./api";
import type { AnimeSearchResult } from "./types";

const SEARCH_PAGE_SIZE = 10;

export function useAnimeSearch() {
  const t = useTranslations();
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [results, setResults] = useState<AnimeSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const paginationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [keyword]);

  useEffect(() => {
    if (!debouncedKeyword) {
      return;
    }

    const controller = new AbortController();
    paginationControllerRef.current?.abort();
    paginationControllerRef.current = null;
    activeControllerRef.current = controller;

    async function runSearch() {
      try {
        setIsLoading(true);
        setIsLoadingMore(false);
        setError(null);
        setPaginationError(null);

        const data = await searchAnime({
          keyword: debouncedKeyword,
          limit: SEARCH_PAGE_SIZE,
          offset: 0,
          signal: controller.signal,
        });

        setResults(data.results);
        setTotal(data.total);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setError(t("search.failed"));
        setPaginationError(null);
        setResults([]);
        setTotal(0);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    runSearch();

    return () => {
      controller.abort();
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    };
  }, [debouncedKeyword, retryKey, t]);

  function updateKeyword(value: string) {
    setKeyword(value);

    if (!value.trim()) {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      paginationControllerRef.current?.abort();
      paginationControllerRef.current = null;
      setResults([]);
      setTotal(0);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(null);
      setPaginationError(null);
    }
  }

  async function loadMore() {
    if (!debouncedKeyword || isLoading || isLoadingMore || error || results.length >= total) {
      return;
    }

    const controller = new AbortController();
    paginationControllerRef.current = controller;

    try {
      setIsLoadingMore(true);
      setPaginationError(null);

      const data = await searchAnime({
        keyword: debouncedKeyword,
        limit: SEARCH_PAGE_SIZE,
        offset: results.length,
        signal: controller.signal,
      });

      setResults((currentResults) => [...currentResults, ...data.results]);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      setPaginationError(t("search.loadMoreFailed"));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingMore(false);
      }

      if (paginationControllerRef.current === controller) {
        paginationControllerRef.current = null;
      }
    }
  }

  function retrySearch() {
    const trimmedKeyword = keyword.trim();

    if (!trimmedKeyword) {
      return;
    }

    if (trimmedKeyword !== debouncedKeyword) {
      setDebouncedKeyword(trimmedKeyword);
      return;
    }

    setRetryKey((current) => current + 1);
  }

  return {
    keyword,
    hasKeyword: Boolean(keyword.trim()),
    results,
    total,
    isLoading,
    isLoadingMore,
    error,
    paginationError,
    hasMore: results.length < total,
    updateKeyword,
    loadMore,
    retrySearch,
  };
}
