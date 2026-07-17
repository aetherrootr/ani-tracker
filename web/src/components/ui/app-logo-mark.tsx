import { cn } from "@/lib/utils";
import { APP_MARK_HIGHLIGHT_PATH, APP_MARK_TRIANGLE_PATH } from "@/lib/app-mark";

export function AppLogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("app-logo-mark", className)} aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <path className="app-logo-mark-triangle" d={APP_MARK_TRIANGLE_PATH} />
        <path className="app-logo-mark-highlight" d={APP_MARK_HIGHLIGHT_PATH} />
      </svg>
    </span>
  );
}
