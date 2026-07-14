import type { NextRequest } from "next/server";

import { pwaIcon512TargetUrl } from "@/lib/app-branding";
import { redirectToBrandingAsset } from "@/lib/branding-redirect";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return redirectToBrandingAsset(request, pwaIcon512TargetUrl);
}
