"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ScrollArea } from "@/components/ui/scroll-area";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
};

export function SelectField<T extends string>({ label, hideLabel = false, disabled = false, value, options, onValueChange }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(options.findIndex((option) => option.value === value), 0));
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const labelId = useId();
  const valueId = useId();
  const listboxId = useId();
  const activeLabel = options.find((option) => option.value === value)?.label ?? value;

  const updatePosition = useEffectEvent(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
    const roomAbove = rect.top - viewportPadding;
    const desiredHeight = Math.min(options.length * 48 + 8, 288);
    const openAbove = roomBelow < Math.min(desiredHeight, 200) && roomAbove > roomBelow;
    const maxHeight = Math.max(96, Math.min(desiredHeight, openAbove ? roomAbove - gap : roomBelow - gap));
    setPosition({
      left: Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - rect.width - viewportPadding),
      top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - gap) : rect.bottom + gap,
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      maxHeight,
    });
  });

  useEffect(() => {
    if (!open) return;
    updatePosition();

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handlePositionChange() {
      updatePosition();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open || !position) return;
    const frame = requestAnimationFrame(() => optionRefs.current.get(activeIndex)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open, position]);

  function closeSelect(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openSelect(direction: 1 | -1 = 1) {
    const selectedIndex = Math.max(options.findIndex((option) => option.value === value), 0);
    setActiveIndex(direction === 1 ? selectedIndex : Math.max(options.length - 1, 0));
    setPosition(null);
    setOpen(true);
  }

  function moveActive(nextIndex: number) {
    const normalized = (nextIndex + options.length) % options.length;
    setActiveIndex(normalized);
    optionRefs.current.get(normalized)?.focus();
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    closeSelect(true);
  }

  return (
    <div className="select-field">
      <div id={labelId} className={hideLabel ? "sr-only" : "select-label"}>{label}</div>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className="select-trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => open ? closeSelect() : openSelect()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openSelect(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            closeSelect(true);
          }
        }}
      >
        <span id={valueId} className="select-value">{activeLabel}</span>
        <ChevronDown className="select-chevron" data-open={open} aria-hidden="true" />
      </button>

      {open && position && typeof document !== "undefined" ? createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          data-select-listbox
          aria-labelledby={labelId}
          className="select-listbox select-content"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          <ScrollArea ariaLabel={label} className="select-options-scroll" viewportClassName="select-options-viewport">
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  if (element) optionRefs.current.set(index, element);
                  else optionRefs.current.delete(index);
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className="select-option"
                data-selected={selected}
                onClick={() => selectOption(index)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveActive(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveActive(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    moveActive(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    moveActive(options.length - 1);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectOption(index);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSelect(true);
                  } else if (event.key === "Tab") {
                    event.preventDefault();
                    focusNextToTrigger(triggerRef.current, event.shiftKey ? -1 : 1);
                    closeSelect();
                  }
                }}
              >
                <span className="select-option-label">{option.label}</span>
                {selected ? <Check className="select-check" aria-hidden="true" /> : null}
              </button>
            );
          })}
          </ScrollArea>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function focusNextToTrigger(trigger: HTMLButtonElement | null, direction: 1 | -1) {
  if (!trigger) return;
  const scope = trigger.closest<HTMLElement>("[role='dialog'], [role='region']") ?? trigger.parentElement;
  const focusable = Array.from(scope?.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
  ) ?? []);
  const index = focusable.indexOf(trigger);
  const target = focusable[index + direction] ?? trigger;
  requestAnimationFrame(() => target.focus());
}
