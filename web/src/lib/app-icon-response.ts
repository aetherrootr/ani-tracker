import { ImageResponse } from "next/og";
import { createElement } from "react";

import { APP_MARK_HIGHLIGHT_PATH, APP_MARK_TRIANGLE_PATH } from "./app-mark";

export function createAppIconResponse(size: number, maskable = false) {
  const markSize = size;
  const triangleSize = maskable ? "58%" : "68%";

  return new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? "#ebe9ff" : "transparent",
        },
      },
      createElement(
        "div",
        {
          style: {
            width: markSize,
            height: markSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            border: `${Math.max(1, Math.round(size / 160))}px solid rgba(102, 87, 232, 0.18)`,
            borderRadius: maskable ? 0 : "24%",
            background: "radial-gradient(circle at 25% 16%, rgba(255,255,255,0.92), transparent 38%), linear-gradient(145deg, #ffffff, #ebe9ff)",
            boxShadow: `inset 0 ${Math.max(1, Math.round(size / 180))}px 0 rgba(255,255,255,0.82)`,
          },
        },
        createElement(
          "svg",
          { viewBox: "0 0 48 48", width: triangleSize, height: triangleSize },
          createElement(
            "defs",
            null,
            createElement(
              "linearGradient",
              { id: "triangle", x1: "12", y1: "10", x2: "36", y2: "38", gradientUnits: "userSpaceOnUse" },
              createElement("stop", { stopColor: "#8d7cff" }),
              createElement("stop", { offset: "0.52", stopColor: "#6657e8" }),
              createElement("stop", { offset: "1", stopColor: "#5144c6" }),
            ),
          ),
          createElement("path", { d: APP_MARK_TRIANGLE_PATH, fill: "url(#triangle)" }),
          createElement("path", { d: APP_MARK_HIGHLIGHT_PATH, fill: "rgba(255,255,255,0.58)" }),
        ),
      ),
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    },
  );
}
