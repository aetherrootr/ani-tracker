type ApiErrorResponse = {
  message?: string;
};

const API_TIMEOUT_MS = 8000;

function getApiBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  return "";
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await withTimeout(
    fetch(`${getApiBaseUrl().replace(/\/$/, "")}${path}`, {
      ...options,
      credentials: "include",
      headers,
    }),
  );

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const errorBody = (await response.json()) as ApiErrorResponse;
      if (errorBody.message) {
        message = errorBody.message;
      }
    } catch {
      // Keep the status-based message when the response is not JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function withTimeout(request: Promise<Response>): Promise<Response> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  return Promise.race([
    request,
    new Promise<Response>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        reject(new Error("Request timed out"));
      }, API_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}
