type ApiErrorResponse = {
  message?: string;
  [key: string]: unknown;
};

export class ApiError extends Error {
  status: number;
  body: ApiErrorResponse | null;

  constructor(message: string, status: number, body: ApiErrorResponse | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const API_TIMEOUT_MS = 8000;

type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
};

function getApiBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  return "";
}

export function getApiUrl(path: string) {
  return `${getApiBaseUrl().replace(/\/$/, "")}${path}`;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = API_TIMEOUT_MS, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(getApiUrl(path), {
      ...fetchOptions,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error("Request timed out");
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let errorBody: ApiErrorResponse | null = null;

    try {
      errorBody = (await response.json()) as ApiErrorResponse;
      if (errorBody.message) {
        message = errorBody.message;
      }
    } catch {
      // Keep the status-based message when the response is not JSON.
    }

    throw new ApiError(message, response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
