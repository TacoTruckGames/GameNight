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
import { reportError } from "./report";

/** One field, one message — the `details` shape a form maps straight onto its inputs. */
export function fieldError(path: string, message: string): ApiFieldError[] {
  return [{ path, message }];
}

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
 * Ids are high-cardinality and would defeat grouping, so the scope is the route
 * shape rather than the concrete path: `/api/events/evt_9f3…/rsvp` →
 * `/api/events/:id/rsvp`. Anything that looks like one of our prefixed ids, a
 * uuid or a long hex run collapses to `:id`.
 */
function scopeFor(method: string, path: string): string {
  const shape = path
    .split("/")
    .map((segment) =>
      /^(u|org|adm|evt|err|aud)_/.test(segment) ||
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(segment) ||
      /^[0-9a-fA-F]{16,}$/.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
  return `http.${method} ${shape}`;
}

/**
 * Anything thrown inside a handler lands here. `ApiError` carries its own
 * status; anything else is a bug and becomes an opaque 500 (the real error is
 * logged, never shipped to the client) *and* a row in `error_log`, which is the
 * admin dashboard's Errors page.
 *
 * The write is awaited: it is one D1 statement, it cannot throw (see
 * `reportError`), and letting the response race it would make the log lossy
 * exactly when the Worker is about to be torn down.
 */
export const onError: ErrorHandler<AppEnv> = async (err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toBody(), err.status);
  }

  const path = new URL(c.req.url).pathname;
  await reportError(c.env.DB, scopeFor(c.req.method, path), err, {
    path,
    userId: c.get("user")?.id ?? null,
  });

  return c.json(errorBody("INTERNAL", "Something went wrong on our side."), 500);
};

/** Unknown `/api/*` path: still JSON, still the same shape. */
export const apiNotFound = (c: Context<AppEnv>) =>
  c.json(errorBody("NOT_FOUND", "That endpoint does not exist."), 404);
