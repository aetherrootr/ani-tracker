import { createBrandingFileResponse } from "@/lib/branding-file-response";

export const dynamic = "force-dynamic";

export function GET() {
  return createBrandingFileResponse("APP_PWA_ICON_192_FILE", "icon-192x192.png", ["image/png"]);
}
