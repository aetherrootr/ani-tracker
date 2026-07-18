"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Input } from "./input";

type FloatingSearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "onChange" | "onCompositionEnd" | "onCompositionStart" | "value"> & {
  children?: ReactNode;
  leading?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  shellClassName?: string;
  barClassName?: string;
};

export function FloatingSearchInput({
  children,
  leading,
  shellClassName,
  barClassName,
  className,
  value,
  onValueChange,
  ...props
}: FloatingSearchInputProps) {
  const composingRef = useRef(false);
  const [compositionValue, setCompositionValue] = useState<string | null>(null);

  return (
    <div className={cn("mobile-sticky-below-top-nav sticky z-30 mx-auto w-full max-w-5xl", shellClassName)}>
      <div className={cn("functional-glass-control glass-surface relative flex items-center gap-2 rounded-[var(--radius-pill)] border p-1.5 transition-shadow focus-within:border-[rgb(102_87_232_/_0.52)] focus-within:ring-4 focus-within:ring-[var(--accent-glow)] sm:p-2", barClassName)}>
        {leading}
        <Input
          type={props.type ?? "search"}
          value={compositionValue ?? value}
          className={cn("h-11 min-w-0 rounded-[var(--radius-pill)] border-0 bg-transparent shadow-none focus-visible:ring-0", className)}
          onChange={(event) => {
            if (composingRef.current) setCompositionValue(event.currentTarget.value);
            else onValueChange(event.currentTarget.value);
          }}
          onCompositionStart={(event) => {
            composingRef.current = true;
            setCompositionValue(event.currentTarget.value);
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            setCompositionValue(null);
            onValueChange(event.currentTarget.value);
          }}
          {...props}
        />
        {children}
      </div>
    </div>
  );
}
