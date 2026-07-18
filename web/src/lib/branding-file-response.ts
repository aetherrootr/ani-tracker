import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";

const contentTypes: Record<string, string> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function createBrandingFileResponse(
  environmentVariable: string,
  fallbackFileName: string,
  allowedContentTypes: readonly string[],
) {
  const configuredPath = process.env[environmentVariable]?.trim();
  const filePath = configuredPath || join(/* turbopackIgnore: true */ process.cwd(), "public", fallbackFileName);
  const contentType = contentTypes[extname(filePath).toLowerCase()];

  if ((configuredPath && !isAbsolute(configuredPath)) || !contentType || !allowedContentTypes.includes(contentType)) {
    return unavailableResponse();
  }

  try {
    const file = await readFile(/* turbopackIgnore: true */ filePath);

    return new Response(new Uint8Array(file), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailableResponse();
  }
}

function unavailableResponse() {
  return new Response("Branding asset is unavailable.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
