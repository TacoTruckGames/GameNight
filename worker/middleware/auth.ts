/**
 * Identity, deliberately minimal: the client sends `X-User-Id` and we trust it.
 *
 * That is a take-home simplification, called out in the README — the shape is
 * the same as a real session (resolve a principal once, hand routes a typed
 * `User`), so swapping in signed cookies touches only this file.
 *
 * An id that is not in `users` is a 401 `UNKNOWN_USER` rather than "anonymous",
 * so a client holding a stale localStorage id learns to clear it instead of
 * silently browsing as a ghost.
 */

import type { Context, MiddlewareHandler } from "hono";

import type { Role, User } from "../../shared/api-types";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";

export const USER_HEADER = "X-User-Id";

/** Resolves `X-User-Id` into `c.get("user")` for every `/api/*` request. */
export const attachUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header(USER_HEADER)?.trim();
  if (!id) {
    c.set("user", null);
    return next();
  }

  const row = await c.env.DB.prepare("SELECT id, name, role FROM users WHERE id = ?1")
    .bind(id)
    .first<{ id: string; name: string; role: string }>();

  if (!row) {
    throw new ApiError(401, "UNKNOWN_USER", "That user no longer exists. Please pick who you are again.");
  }

  c.set("user", { id: row.id, name: row.name, role: row.role as Role });
  return next();
};

/** 401 when there is no caller. */
export function requireUser(c: Context<AppEnv>): User {
  const user = c.get("user");
  if (!user) {
    throw new ApiError(401, "AUTH_REQUIRED", "Pick who you are first.");
  }
  return user;
}

function requireRole(c: Context<AppEnv>, role: Role, message: string): User {
  const user = requireUser(c);
  if (user.role !== role) {
    throw new ApiError(403, "FORBIDDEN", message);
  }
  return user;
}

/** 401 when signed out, 403 for organizers. */
export function requirePlayer(c: Context<AppEnv>): User {
  return requireRole(c, "player", "Only players can RSVP. Switch to a player account.");
}

/** 401 when signed out, 403 for players. */
export function requireOrganizer(c: Context<AppEnv>): User {
  return requireRole(c, "organizer", "Only organizers can do that.");
}
