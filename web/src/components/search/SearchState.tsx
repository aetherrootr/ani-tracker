import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

type SearchStateProps = {
  hasKeyword: boolean;
  error: string | null;
  isLoading: boolean;
  total: number;
  resultCount: number;
  keyword: string;
  provider: string;
  onRetry: () => void;
  onClear: () => void;
  onChooseProvider: () => void;
};

export function SearchState({ hasKeyword, error, isLoading, total, resultCount, keyword, provider, onRetry, onClear, onChooseProvider }: SearchStateProps) {
  const t = useTranslations();

  if (!hasKeyword) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/70 px-5 py-6 text-center text-muted-foreground">
        <Search className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
        <p>{t("search.emptyPrompt")}</p>
        <p className="mt-1 text-sm">{t("search.emptyExample")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t("search.loading")}
        </div>
        {[0, 1].map((item) => (
          <div key={item} className="grid grid-cols-[72px_1fr] gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[96px_1fr] sm:p-4" aria-hidden="true">
            <div className="aspect-[2/3] animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
            <div className="space-y-3 py-1"><div className="h-5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-16 animate-pulse rounded bg-muted motion-reduce:animate-none" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 text-sm" role="status" aria-live="polite">
        <p className="text-destructive">{error}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>{t("search.retrySearch")}</Button>
      </div>
    );
  }

  if (resultCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/70 px-5 py-6 text-center text-muted-foreground">
        <p>{t("search.noResultsFor", { keyword, provider })}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={onClear}>{t("search.clearSearch")}</Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={onChooseProvider}>{t("search.switchProvider")}</Button>
        </div>
      </div>
    );
  }

  return <div className="text-sm text-muted-foreground">{t("search.resultSummary", { total, resultCount })}</div>;
}
