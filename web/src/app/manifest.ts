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
    background_color: "#fafafa",
    theme_color: "#fafafa",
    icons: [
      {
        src: pwaIcon192Url,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: pwaIcon512Url,
        sizes: "512x512",
        type: "image/png",
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
