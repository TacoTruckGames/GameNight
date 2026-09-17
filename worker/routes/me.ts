/**
 * "About the caller" endpoints.
 *
 * `GET /api/me` is also the client's boot check: a 401 `UNKNOWN_USER` tells it
 * the stored id is stale and the identity picker should come back.
 */

import { Hono } from "hono";

import { dateWindowQuerySchema } from "../../shared/schemas";
import { listHostedEvents, listPlayerRsvps } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { nowIso, toStorageWindow } from "../lib/time";
import { parseQuery } from "../lib/validate";
import { requireOrganizer, requirePlayer, requireUser } from "../middleware/auth";

export const me = new Hono<AppEnv>();

me.get("/me", (c) => c.json(requireUser(c)));

/**
 * Both personal lists take the board's optional `?from=&to=` window, same
 * half-open semantics and the same both-or-neither rule: without it, upcoming
 * only; with it, that span and `now` no longer applies, so the week agenda can
 * page back over what you already went to.
 *
 * The auth check comes **first**, before the query is even parsed. Who you are
 * is a better answer than what you typed: a signed-out caller with a malformed
 * window should be told to sign in, not handed a field error about a list they
 * are not allowed to read.
 */
me.get("/me/rsvps", async (c) => {
  const user = requirePlayer(c);
  const window = toStorageWindow(parseQuery(c, dateWindowQuerySchema));
  return c.json(await listPlayerRsvps(c.env.DB, user.id, { now: nowIso(), ...window }));
});

me.get("/me/hosted", async (c) => {
  const user = requireOrganizer(c);
  const window = toStorageWindow(parseQuery(c, dateWindowQuerySchema));
  return c.json(await listHostedEvents(c.env.DB, user.id, { now: nowIso(), ...window }));
});
