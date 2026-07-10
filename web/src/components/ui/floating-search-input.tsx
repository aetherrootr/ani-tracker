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
    <div className={cn("sticky top-[7.25rem] z-30 mx-auto w-full max-w-5xl md:top-3", shellClassName)}>
      <div className={cn("glass-surface relative flex items-center gap-2 rounded-full border p-2", barClassName)}>
        {leading}
        <Input
          className={cn("h-10 rounded-full border-0 bg-transparent shadow-none focus-visible:ring-0", className)}
          {...props}
        />
        {children}
      </div>
    </div>
  );
}
