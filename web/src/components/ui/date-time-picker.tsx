"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Labels = {
  open: string;
  previousMonth: string;
  nextMonth: string;
  date: string;
  hour: string;
  minute: string;
  done: string;
};

export function DateTimePicker({ value, locale, labels, disabled, onChange }: { value: string; locale: string; labels: Labels; disabled?: boolean; onChange: (value: string) => void }) {
  const selected = parseLocalDateTime(value);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selected ?? new Date()));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const weekStartsOn = locale.toLowerCase().startsWith("en-us") ? 0 : 1;
  const days = useMemo(() => calendarDays(visibleMonth, weekStartsOn), [visibleMonth, weekStartsOn]);
  const weekdays = useMemo(() => weekdayLabels(locale, weekStartsOn), [locale, weekStartsOn]);
  const displayValue = selected
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(selected)
    : labels.open;

  function selectDate(date: Date) {
    const time = selected ?? new Date(2000, 0, 1, 0, 0);
    onChange(toLocalDateTimeValue(new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes())));
  }

  function changeTime(part: "hour" | "minute", rawValue: string) {
    const date = selected ?? visibleMonth;
    const maximum = part === "hour" ? 23 : 59;
    const parsed = Number.parseInt(rawValue, 10);
    const next = Number.isNaN(parsed) ? 0 : Math.min(Math.max(parsed, 0), maximum);
    onChange(toLocalDateTimeValue(new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      part === "hour" ? next : date.getHours(),
      part === "minute" ? next : date.getMinutes(),
    )));
  }

  function moveSelection(date: Date, offset: number) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    if (next.getMonth() !== visibleMonth.getMonth()) return;
    selectDate(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${dateKey(next)}"]`)?.focus());
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="min-h-11 w-full justify-start gap-2 bg-card text-left font-normal" disabled={disabled} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{displayValue}</span>
      </Button>

      {open ? (
        <div className="rounded-2xl border bg-card p-3 shadow-sm" aria-label={labels.date}>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={labels.previousMonth} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="font-semibold">{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(visibleMonth)}</div>
            <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={labels.nextMonth} onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-1 grid grid-cols-7 text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday} className="py-2">{weekday}</span>)}
          </div>
          <div ref={gridRef} className="grid grid-cols-7 gap-1" role="grid" aria-label={labels.date}>
            {days.map((date, index) => date ? (
              <button
                key={dateKey(date)}
                type="button"
                data-date={dateKey(date)}
                className="flex min-h-11 min-w-0 items-center justify-center rounded-xl text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/20 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date)}
                aria-pressed={sameDay(date, selected)}
                tabIndex={sameDay(date, selected) || (!days.some((day) => sameDay(day, selected)) && index === days.findIndex(Boolean)) ? 0 : -1}
                onClick={() => selectDate(date)}
                onKeyDown={(event) => {
                  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                  const offset = offsets[event.key];
                  if (!offset) return;
                  event.preventDefault();
                  moveSelection(date, offset);
                }}
              >
                {date.getDate()}
              </button>
            ) : <span key={`empty-${index}`} aria-hidden="true" />)}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
            <Clock3 className="mb-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <TimeField key={`hour-${selected?.getHours() ?? 0}`} label={labels.hour} value={selected?.getHours() ?? 0} disabled={disabled} onCommit={(next) => changeTime("hour", next)} />
            <span className="mb-2.5 font-semibold text-muted-foreground" aria-hidden="true">:</span>
            <TimeField key={`minute-${selected?.getMinutes() ?? 0}`} label={labels.minute} value={selected?.getMinutes() ?? 0} disabled={disabled} onCommit={(next) => changeTime("minute", next)} />
            <Button type="button" size="sm" className="ml-auto min-h-11" onClick={() => setOpen(false)}>{labels.done}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeField({ label, value, disabled, onCommit }: { label: string; value: number; disabled?: boolean; onCommit: (value: string) => void }) {
  return (
    <label className="w-16 space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="min-h-11 text-center text-foreground"
        defaultValue={String(value).padStart(2, "0")}
        disabled={disabled}
        maxLength={2}
        onBlur={(event) => onCommit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function parseLocalDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarDays(month: Date, weekStartsOn: number) {
  const firstOffset = (month.getDay() - weekStartsOn + 7) % 7;
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: firstOffset + dayCount }, (_, index) => index < firstOffset ? null : new Date(month.getFullYear(), month.getMonth(), index - firstOffset + 1));
}

function weekdayLabels(locale: string, weekStartsOn: number) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, 7 + ((weekStartsOn + index) % 7)));
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(day);
  });
}

function sameDay(left: Date | null, right: Date | null) {
  return Boolean(left && right && left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate());
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalDateTimeValue(date: Date) {
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
