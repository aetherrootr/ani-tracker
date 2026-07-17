"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  widthMode?: "equal" | "content";
  fullWidth?: boolean;
  disabled?: boolean;
  semantic?: "radiogroup" | "tablist";
  className?: string;
  optionClassName?: string;
  motion?: "smooth" | "none";
};

type ThumbGeometry = {
  left: number;
  width: number;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  size = "md",
  widthMode = "equal",
  fullWidth = false,
  disabled = false,
  semantic = "radiogroup",
  className,
  optionClassName,
  motion = "smooth",
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());
  const measuredRef = useRef(false);
  const selectedIndex = Math.max(options.findIndex((option) => option.value === value), 0);
  const [thumb, setThumb] = useState<ThumbGeometry | null>(null);
  const [animateThumb, setAnimateThumb] = useState(false);

  const enabledOptions = options.filter((option) => !option.disabled);

  const updateThumb = useCallback(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    if (widthMode === "equal") {
      setThumb(null);
      return;
    }

    const button = buttonRefs.current.get(value);
    if (!button) {
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    setThumb({ left: buttonRect.left - trackRect.left, width: buttonRect.width });
    if (!measuredRef.current) {
      measuredRef.current = true;
      requestAnimationFrame(() => setAnimateThumb(true));
    }
  }, [value, widthMode]);

  useEffect(() => {
    const frame = requestAnimationFrame(updateThumb);
    return () => cancelAnimationFrame(frame);
  }, [options, updateThumb]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateThumb);
    observer.observe(track);
    for (const button of buttonRefs.current.values()) {
      observer.observe(button);
    }
    return () => observer.disconnect();
  }, [options, updateThumb]);

  function selectOption(next: T) {
    if (disabled || next === value) {
      return;
    }
    const option = options.find((item) => item.value === next);
    if (!option || option.disabled) {
      return;
    }
    onValueChange(next);
  }

  function focusOption(next: T) {
    buttonRefs.current.get(next)?.focus();
  }

  function moveFocus(direction: 1 | -1) {
    if (enabledOptions.length === 0) {
      return;
    }
    const currentEnabledIndex = Math.max(enabledOptions.findIndex((option) => option.value === value), 0);
    const next = enabledOptions[(currentEnabledIndex + direction + enabledOptions.length) % enabledOptions.length];
    if (next) {
      focusOption(next.value);
      selectOption(next.value);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = enabledOptions[0];
      if (first) {
        focusOption(first.value);
        selectOption(first.value);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      const last = enabledOptions.at(-1);
      if (last) {
        focusOption(last.value);
        selectOption(last.value);
      }
    }
  }

  const role = semantic === "tablist" ? "tablist" : "radiogroup";
  const optionRole = semantic === "tablist" ? "tab" : "radio";
  const selectedAttribute = semantic === "tablist" ? "aria-selected" : "aria-checked";

  return (
    <div className={cn(fullWidth ? "w-full" : "inline-flex", className)}>
      <div
        ref={trackRef}
        role={role}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        data-size={size}
        data-width-mode={widthMode}
        className={cn(
          "segmented-track relative grid items-center gap-0 rounded-[var(--segment-radius)] border p-[var(--segment-inset)]",
          fullWidth && "w-full",
          widthMode === "content" && "grid-flow-col",
        )}
        style={widthMode === "equal" ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
        onKeyDown={handleKeyDown}
      >
        <div
          aria-hidden="true"
          className={cn(
            "segmented-thumb pointer-events-none absolute top-[var(--segment-inset)] z-0 rounded-[var(--segment-thumb-radius)]",
            motion === "none" || (widthMode === "content" && !animateThumb) ? "transition-none" : "transition-[transform,width,box-shadow,background-color] duration-[var(--segment-duration)] ease-[var(--segment-ease)]",
          )}
          style={widthMode === "equal"
            ? {
                left: "var(--segment-inset)",
                width: `calc((100% - var(--segment-inset) * 2) / ${options.length})`,
                transform: `translate3d(${selectedIndex * 100}%, 0, 0)`,
              }
            : thumb
              ? { left: 0, width: thumb.width, transform: `translate3d(${thumb.left}px, 0, 0)`, opacity: 1 }
              : { opacity: 0 }}
        />
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                if (element) {
                  buttonRefs.current.set(option.value, element);
                } else {
                  buttonRefs.current.delete(option.value);
                }
              }}
              type="button"
              role={optionRole}
              aria-label={option.ariaLabel}
              {...{ [selectedAttribute]: selected }}
              data-selected={selected}
              disabled={disabled || option.disabled}
              tabIndex={selected ? 0 : -1}
              className={cn(
                "segmented-option relative z-10 grid min-w-0 place-items-center rounded-[var(--segment-thumb-radius)] px-[var(--segment-inline-padding)] text-[length:var(--segment-font-size)] font-semibold text-[var(--segment-text)] transition-colors duration-[var(--segment-duration-fast)] hover:text-[var(--segment-text-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-60 data-[selected=true]:text-[var(--segment-thumb-text)]",
                optionClassName,
              )}
              onClick={() => selectOption(option.value)}
            >
              <span className="inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap leading-[1.25] transition-transform duration-[var(--segment-duration-fast)] active:scale-[0.975]">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SlidingOptionGroup<T extends string>({
  options,
  value,
  render,
  onChange,
  ariaLabel,
  size,
  className,
  buttonClassName,
}: {
  options: readonly T[];
  value: T;
  render: (value: T) => ReactNode;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  buttonClassName?: string;
}) {
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      options={options.map((option) => ({ value: option, label: render(option) }))}
      value={value}
      onValueChange={onChange}
      size={size}
      widthMode="equal"
      fullWidth
      className={className}
      optionClassName={buttonClassName}
    />
  );
}
