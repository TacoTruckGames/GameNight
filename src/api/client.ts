/**
 * The one place the SPA talks to the Worker.
 *
 * Two failure modes, deliberately distinguished, because the UI treats them
 * differently:
 *   - `ApiError`     the server answered with `{ error: { code, message } }`.
 *                    Never retried automatically: a 403 or a 409 will not get
 *                    better on a second try.
 *   - `NetworkError` the request never produced an answer (offline, flaky
 *                    commute signal). Safe to retry, and the RSVP routes are
 *                    idempotent by contract (PUT/DELETE), so we do.
 */

import type { ApiErrorBody, ApiErrorCode, ApiFieldError } from "../../shared/api-types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiFieldError[] | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiFieldError[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NetworkError extends Error {
  constructor(message = "Can't reach the server. Check your connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Serialized as JSON when present. */
  body?: unknown;
  /** Sent as `X-User-Id`; the Worker's only notion of identity. */
  userId?: string | null;
  signal?: AbortSignal;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

/**
 * Resolves with the parsed JSON body, or throws `ApiError` / `NetworkError`.
 *
 * Anything that is not JSON (an HTML SPA fallback, a proxy error page) is
 * reported as an `INTERNAL` `ApiError` rather than crashing a component — the
 * UI must never break, it shows an error banner with Retry.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, userId, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (userId) headers["X-User-Id"] = userId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    // An aborted request is a cancellation, not a failure — let it through as-is
    // so TanStack Query doesn't count it against the retry budget.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new NetworkError();
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text === "" ? null : JSON.parse(text);
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError(response.status, payload.error.code, payload.error.message, payload.error.details);
    }
    throw new ApiError(response.status, "INTERNAL", `Something went wrong (HTTP ${response.status}).`);
  }

  if (payload === undefined) {
    throw new ApiError(response.status, "INTERNAL", "Unexpected response from the server.");
  }

  return payload as T;
}
