import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Input } from "./input";

type FloatingSearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  children?: ReactNode;
  leading?: ReactNode;
  shellClassName?: string;
  barClassName?: string;
};

export function FloatingSearchInput({
  children,
  leading,
  shellClassName,
  barClassName,
  className,
  ...props
}: FloatingSearchInputProps) {
  return (
    <div className={cn("mobile-sticky-below-top-nav sticky z-30 mx-auto w-full max-w-5xl", shellClassName)}>
      <div className={cn("functional-glass-control glass-surface relative flex items-center gap-2 rounded-[var(--radius-pill)] border p-1.5 transition-shadow focus-within:border-[rgb(102_87_232_/_0.52)] focus-within:ring-4 focus-within:ring-[var(--accent-glow)] sm:p-2", barClassName)}>
        {leading}
        <Input
          type={props.type ?? "search"}
          className={cn("h-11 min-w-0 rounded-[var(--radius-pill)] border-0 bg-transparent shadow-none focus-visible:ring-0", className)}
          {...props}
        />
        {children}
      </div>
    </div>
  );
}
