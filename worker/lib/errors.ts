/**
 * One error shape for the whole API.
 *
 * Every non-2xx response from `/api/*` — including unknown routes and
 * unexpected throws — is `{ error: { code, message, details? } }`, so the
 * client has exactly one branch to write. `code` is the machine-readable part
 * (see `ApiErrorCode`); `message` is safe to show a user as-is.
 */

import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiErrorBody, ApiErrorCode, ApiFieldError } from "../../shared/api-types";
import type { AppEnv } from "./context";

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  readonly details?: ApiFieldError[];

  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, details?: ApiFieldError[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

function errorBody(code: ApiErrorCode, message: string, details?: ApiFieldError[]): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/**
 * Anything thrown inside a handler lands here. `ApiError` carries its own
 * status; anything else is a bug and becomes an opaque 500 (the real error is
 * logged, never shipped to the client).
 */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status);
  }
  console.error("Unhandled error", err);
  return c.json(errorBody("INTERNAL", "Something went wrong on our side."), 500);
};

/** Unknown `/api/*` path: still JSON, still the same shape. */
export const apiNotFound = (c: Context<AppEnv>) =>
  c.json(errorBody("NOT_FOUND", "That endpoint does not exist."), 404);
