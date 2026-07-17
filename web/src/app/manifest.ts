import type { MetadataRoute } from "next";

import { pwaIcon192Url, pwaIcon512Url, pwaMaskableIconUrl } from "@/lib/app-branding";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ani Tracker",
    short_name: "Ani Tracker",
    description: "Anime tracking progress management Web App",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f4f8",
    theme_color: "#f3f4f8",
    icons: [
      {
        src: pwaIcon192Url,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: pwaIcon512Url,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: pwaMaskableIconUrl,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
