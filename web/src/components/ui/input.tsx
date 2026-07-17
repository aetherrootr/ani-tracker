import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "interactive-surface flex h-11 w-full rounded-[var(--radius-input)] border border-input bg-[var(--surface-card)] px-3 py-2 text-base shadow-[var(--shadow-low)] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-[rgb(102_87_232_/_45%)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgb(102_87_232_/_12%)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        type === "search" && "rounded-[var(--radius-pill)]",
        className,
      )}
      {...props}
    />
  );
}
