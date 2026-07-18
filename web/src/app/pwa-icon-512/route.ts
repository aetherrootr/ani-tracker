import { createBrandingFileResponse } from "@/lib/branding-file-response";

export const dynamic = "force-dynamic";

export function GET() {
  return createBrandingFileResponse("APP_PWA_ICON_512_FILE", "icon-512x512.png", ["image/png"]);
}
