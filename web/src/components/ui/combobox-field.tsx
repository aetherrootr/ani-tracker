"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ComboboxFieldProps = {
  label: string;
  value: string;
  options: readonly string[];
  placeholder?: string;
  emptyMessage: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
};

export function ComboboxField({ label, value, options, placeholder, emptyMessage, disabled, onValueChange }: ComboboxFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const hintId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 80)
    : options.slice(0, 80);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 8;
      const viewportPadding = 12;
      const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
      const roomAbove = rect.top - viewportPadding;
      const openAbove = roomBelow < 220 && roomAbove > roomBelow;
      const maxHeight = Math.min(320, Math.max(160, (openAbove ? roomAbove : roomBelow) - gap));
      setPosition({
        left: Math.min(rect.left, window.innerWidth - rect.width - viewportPadding),
        top: openAbove ? rect.top - maxHeight - gap : rect.bottom + gap,
        width: rect.width,
        maxHeight,
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (inputRef.current?.parentElement?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setQuery(value);
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, value]);

  function selectOption(option: string) {
    setQuery(option);
    setOpen(false);
    onValueChange(option);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="grid gap-2">
      <label className="select-label" htmlFor={listId}>{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          id={listId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${listId}-listbox` : undefined}
          aria-activedescendant={open && filteredOptions[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          className="interactive-surface block h-11 w-full appearance-none rounded-[var(--radius-input)] border border-[var(--select-border)] bg-[var(--surface-solid)] px-3.5 py-2 pr-11 text-sm text-foreground shadow-[var(--shadow-low)] focus:border-[rgb(102_87_232_/_45%)] focus:outline-none focus:ring-4 focus:ring-[rgb(102_87_232_/_12%)] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onFocus={(event) => {
            event.currentTarget.select();
            setActiveIndex(0);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && open && filteredOptions[activeIndex]) {
              event.preventDefault();
              selectOption(filteredOptions[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setQuery(value);
            }
          }}
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <span id={hintId} className="sr-only">{label}</span>

      {open && position && typeof document !== "undefined" ? createPortal(
        <div
          ref={listRef}
          id={`${listId}-listbox`}
          role="listbox"
          aria-label={label}
          className="select-content fixed z-[var(--z-select)] overflow-y-auto overscroll-contain rounded-[var(--radius-input)] border border-[var(--select-list-border)] bg-[var(--select-list-surface)] p-1.5 shadow-[var(--select-list-shadow)]"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          {filteredOptions.length ? filteredOptions.map((option, index) => (
            <button
              key={option}
              id={`${listId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={option === value}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm text-foreground hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] data-[active=true]:bg-[var(--accent-soft)] aria-selected:font-semibold aria-selected:text-[var(--accent-solid)]"
              data-active={index === activeIndex}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span>{option}</span>
              {option === value ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
            </button>
          )) : <p className="p-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
