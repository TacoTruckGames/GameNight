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

  const row = await c.env.DB.prepare("SELECT id, name, role, suspended_at FROM users WHERE id = ?1")
    .bind(id)
    .first<{ id: string; name: string; role: string; suspended_at: string | null }>();

  if (!row) {
    throw new ApiError(401, "UNKNOWN_USER", "That user no longer exists. Please pick who you are again.");
  }

  // Suspension is enforced once, here, before `c.set` — so no route has to
  // remember to check it and a suspended account cannot reach any handler.
  // The client treats this like a 401: clear the identity, back to the picker.
  if (row.suspended_at) {
    throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account has been suspended.");
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

/**
 * 401 when signed out, 403 for everyone else. Exact-role, like the other two,
 * which is also why an admin cannot RSVP or post an event: the operator account
 * is for operating, not for playing.
 */
export function requireAdmin(c: Context<AppEnv>): User {
  return requireRole(c, "admin", "Admins only.");
}

/**
 * The one place the exact-role rule bends, and only for a *read*.
 *
 * Venue autocomplete costs money per keystroke, so it cannot be anonymous — but
 * the two people who fill in a venue field are the organizer posting an event
 * and the admin fixing one, and an operator locked out of the tool they are
 * meant to operate with is not a security boundary, it is a bug. Nothing is
 * written here, so the usual "operators operate, they do not play" reasoning
 * does not apply.
 */
export function requireOrganizerOrAdmin(c: Context<AppEnv>): User {
  const user = requireUser(c);
  if (user.role !== "organizer" && user.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Only organizers can look up a venue.");
  }
  return user;
}
