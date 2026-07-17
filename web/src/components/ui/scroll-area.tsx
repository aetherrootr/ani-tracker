"use client";

import type { KeyboardEvent, PointerEvent, ReactNode, UIEventHandler } from "react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  ariaLabel: string;
  showScrollbar?: boolean;
  viewportAs?: "div" | "main";
  viewportId?: string;
  viewportTabIndex?: number;
  onViewportScroll?: UIEventHandler<HTMLElement>;
  className?: string;
  viewportClassName?: string;
};

type Metrics = {
  visible: boolean;
  offset: number;
  size: number;
  max: number;
  now: number;
};

export const ScrollArea = forwardRef<HTMLElement, Props>(function ScrollArea(
  { children, ariaLabel, showScrollbar = true, viewportAs = "div", viewportId, viewportTabIndex, onViewportScroll, className, viewportClassName },
  forwardedRef,
) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const scrollingTimeoutRef = useRef<number | null>(null);
  const generatedViewportId = useId();
  const [scrolling, setScrolling] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>({ visible: false, offset: 0, size: 0, max: 0, now: 0 });

  useImperativeHandle(forwardedRef, () => viewportRef.current as HTMLElement, []);

  useEffect(() => {
    if (!showScrollbar) return;
    if (!viewportRef.current || !trackRef.current) return;
    const viewport: HTMLElement = viewportRef.current;
    const track: HTMLDivElement = trackRef.current;
    let frame: number | null = null;

    function updateMetrics() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const max = Math.max(viewport.scrollHeight - viewport.clientHeight, 0);
        const trackHeight = track.clientHeight;
        const size = max > 0 ? Math.max(32, trackHeight * (viewport.clientHeight / viewport.scrollHeight)) : trackHeight;
        const travel = Math.max(trackHeight - size, 0);
        const offset = max > 0 ? (viewport.scrollTop / max) * travel : 0;
        setMetrics({ visible: max > 1, offset, size, max, now: viewport.scrollTop });
      });
    }

    function handleScroll() {
      updateMetrics();
      setScrolling(true);
      if (scrollingTimeoutRef.current !== null) window.clearTimeout(scrollingTimeoutRef.current);
      scrollingTimeoutRef.current = window.setTimeout(() => setScrolling(false), 700);
    }

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    const mutationObserver = new MutationObserver(updateMetrics);
    mutationObserver.observe(viewport, { childList: true, subtree: true, characterData: true });
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (scrollingTimeoutRef.current !== null) window.clearTimeout(scrollingTimeoutRef.current);
      observer.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [showScrollbar]);

  function setScrollFromThumb(pointerY: number) {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!viewport || !track || !drag) return;
    const travel = Math.max(track.clientHeight - metrics.size, 1);
    viewport.scrollTop = drag.scrollTop + ((pointerY - drag.pointerY) / travel) * metrics.max;
  }

  function handleThumbPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerY: event.clientY, scrollTop: viewportRef.current?.scrollTop ?? 0 };
    setScrolling(true);
  }

  function handleTrackPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    event.preventDefault();
    const relativeY = event.clientY - track.getBoundingClientRect().top - metrics.size / 2;
    const travel = Math.max(track.clientHeight - metrics.size, 1);
    viewport.scrollTop = (Math.min(Math.max(relativeY, 0), travel) / travel) * metrics.max;
  }

  function handleScrollbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const page = viewport.clientHeight * 0.8;
    const actions: Record<string, number> = {
      ArrowUp: viewport.scrollTop - 40,
      ArrowDown: viewport.scrollTop + 40,
      PageUp: viewport.scrollTop - page,
      PageDown: viewport.scrollTop + page,
      Home: 0,
      End: metrics.max,
    };
    const next = actions[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ top: next, behavior: reduceMotion || event.key.startsWith("Arrow") ? "auto" : "smooth" });
  }

  const Viewport = viewportAs;
  const resolvedViewportId = viewportId ?? generatedViewportId;

  return (
    <div className={cn("scroll-area", className)} data-scrolling={scrolling || undefined}>
      <Viewport ref={(element) => { viewportRef.current = element; }} id={resolvedViewportId} tabIndex={viewportTabIndex} className={cn("scroll-area-viewport", viewportClassName)} onScroll={onViewportScroll}>
        {children}
      </Viewport>
      {showScrollbar ? <div
        ref={trackRef}
        className="scroll-area-track"
        role="scrollbar"
        aria-label={ariaLabel}
        aria-controls={resolvedViewportId}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(metrics.max)}
        aria-valuenow={Math.round(metrics.now)}
        data-visible={metrics.visible || undefined}
        tabIndex={metrics.visible ? 0 : -1}
        onKeyDown={handleScrollbarKeyDown}
        onPointerDown={handleTrackPointerDown}
      >
        <div
          className="scroll-area-thumb"
          style={{ height: metrics.size, transform: `translateY(${metrics.offset}px)` }}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={(event) => {
            if (dragRef.current) setScrollFromThumb(event.clientY);
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        />
      </div> : null}
    </div>
  );
});
