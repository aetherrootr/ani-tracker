import { NextResponse, type NextRequest } from "next/server";

export function redirectToBrandingAsset(request: NextRequest, targetUrl: string) {
  return NextResponse.redirect(new URL(targetUrl, request.url), {
    status: 307,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
