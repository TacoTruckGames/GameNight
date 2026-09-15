/**
 * zod → `ApiError` glue. Ten lines instead of `@hono/zod-validator`, because
 * the only thing the middleware would buy us is the part we want to control:
 * how a `ZodError` becomes `details: { path, message }[]`.
 */

import type { Context } from "hono";
import type { z } from "zod";

import type { ApiFieldError } from "../../shared/api-types";
import type { AppEnv } from "./context";
import { ApiError } from "./errors";

function toFieldErrors(error: z.ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    // `["capacity"]` → `"capacity"`; nested/array paths dot-join, e.g. `"a.0.b"`.
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

/** Validate an already-decoded value, or throw 400 `VALIDATION_FAILED`. */
function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_FAILED", "Please fix the highlighted fields.", toFieldErrors(result.error));
  }
  return result.data;
}

/** Read + validate a JSON request body. A malformed body is a 400, not a 500. */
export async function parseJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return parseWith(schema, body);
}

/** Validate the query string (every value arrives as a string or not at all). */
export function parseQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}
