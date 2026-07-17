import { createAppIconResponse } from "@/lib/app-icon-response";

export const dynamic = "force-dynamic";

export function GET() {
  return createAppIconResponse(256);
}
