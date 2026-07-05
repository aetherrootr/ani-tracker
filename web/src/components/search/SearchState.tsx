import { Loader2 } from "lucide-react";

type SearchStateProps = {
  hasKeyword: boolean;
  error: string | null;
  isLoading: boolean;
  total: number;
  resultCount: number;
};

export function SearchState({ hasKeyword, error, isLoading, total, resultCount }: SearchStateProps) {
  if (!hasKeyword) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">
        输入动画名称开始搜索
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        搜索中...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border bg-card p-4 text-sm text-destructive">{error}</div>;
  }

  if (resultCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">
        没有找到相关动画
      </div>
    );
  }

  return (
    <div className="text-sm text-muted-foreground">
      共找到 {total} 个结果，当前显示 {resultCount} 个
    </div>
  );
}
