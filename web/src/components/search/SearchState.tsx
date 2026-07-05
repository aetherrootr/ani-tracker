import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type SearchStateProps = {
  hasKeyword: boolean;
  error: string | null;
  isLoading: boolean;
  total: number;
  resultCount: number;
};

export function SearchState({ hasKeyword, error, isLoading, total, resultCount }: SearchStateProps) {
  const t = useTranslations();

  if (!hasKeyword) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">
        {t("search.emptyPrompt")}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("search.loading")}
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border bg-card p-4 text-sm text-destructive">{error}</div>;
  }

  if (resultCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">
        {t("search.noResults")}
      </div>
    );
  }

  return (
    <div className="text-sm text-muted-foreground">
      {t("search.resultSummary", { total, resultCount })}
    </div>
  );
}
