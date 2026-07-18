import { createBrandingFileResponse } from "@/lib/branding-file-response";

export const dynamic = "force-dynamic";

export function GET() {
  return createBrandingFileResponse("APP_APPLE_TOUCH_ICON_FILE", "apple-touch-icon.png", ["image/png"]);
}
