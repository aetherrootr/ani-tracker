"use client";

import Image from "next/image";
import type { ReactEventHandler } from "react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  draggable?: boolean;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onError?: ReactEventHandler<HTMLImageElement>;
};

export function PosterImage({ src, alt, sizes, className, draggable, onLoad, onError }: Props) {
  const isSafari = useSafariBrowser();

  if (isSafari) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={src}
        src={src}
        alt={alt}
        className={cn("absolute inset-0 h-full w-full", className)}
        draggable={draggable}
        loading="eager"
        decoding="sync"
        onLoad={onLoad}
        onError={onError}
      />
    );
  }

  return (
    <Image
      key={src}
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      className={className}
      draggable={draggable}
      onLoad={onLoad}
      onError={onError}
    />
  );
}

function useSafariBrowser() {
  return useSyncExternalStore(subscribe, getSafariSnapshot, getServerSnapshot);
}

function subscribe() {
  return () => {};
}

function getServerSnapshot() {
  return false;
}

function getSafariSnapshot() {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent;
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
}
