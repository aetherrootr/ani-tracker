import { createBrandingFileResponse } from "@/lib/branding-file-response";

export const dynamic = "force-dynamic";

export function GET() {
  return createBrandingFileResponse(
    "APP_FAVICON_FILE",
    "liquid-glass-play-icon.svg",
    ["image/svg+xml", "image/png", "image/x-icon"],
  );
}
