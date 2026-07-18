"use client";

import { useState } from "react";

import { getApiUrl } from "@/lib/api-client";

export function AuthWallpaper() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div className={`auth-wallpaper ${loaded ? "is-loaded" : ""}`} aria-hidden="true">
      <picture>
        <source
          media="not all and (min-width: 768px) and (any-hover: hover) and (any-pointer: fine)"
          srcSet={getApiUrl("/api/auth/background/mobile")}
        />
        <img
          className="auth-wallpaper-image"
          src={getApiUrl("/api/auth/background/desktop")}
          alt=""
          fetchPriority="high"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      </picture>
    </div>
  );
}
