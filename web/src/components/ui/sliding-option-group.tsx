import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function SlidingOptionGroup<T extends string>({
  options,
  value,
  render,
  onChange,
  className,
  buttonClassName,
}: {
  options: readonly T[];
  value: T;
  render: (value: T) => ReactNode;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
}) {
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const updateIndicator = useCallback(() => {
    const button = buttonRefs.current.get(value);
    if (!button) {
      setIndicator(null);
      return;
    }

    setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
  }, [value]);

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(updateIndicator);
    window.addEventListener("resize", updateIndicator);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateIndicator);
    };
  }, [options, updateIndicator]);

  return (
    <div
      className={cn("relative grid gap-1 rounded-2xl bg-background/20 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {indicator ? (
        <div
          className="absolute top-1 h-[calc(100%-0.5rem)] rounded-xl bg-primary shadow-md transition-[width,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
          aria-hidden="true"
        />
      ) : null}
      {options.map((option) => (
        <button
          key={option}
          ref={(element) => {
            if (element) {
              buttonRefs.current.set(option, element);
              return;
            }
            buttonRefs.current.delete(option);
          }}
          type="button"
          className={cn(
            "relative z-10 min-h-10 rounded-xl px-2 py-2 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:text-foreground",
            option === value && "text-primary-foreground hover:text-primary-foreground",
            buttonClassName,
          )}
          onClick={() => onChange(option)}
        >
          {render(option)}
        </button>
      ))}
    </div>
  );
}
