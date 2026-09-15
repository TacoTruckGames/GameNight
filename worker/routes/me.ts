/**
 * "About the caller" endpoints.
 *
 * `GET /api/me` is also the client's boot check: a 401 `UNKNOWN_USER` tells it
 * the stored id is stale and the identity picker should come back.
 */

import { Hono } from "hono";

import { listHostedEvents, listPlayerRsvps } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { nowIso } from "../lib/time";
import { requireOrganizer, requirePlayer, requireUser } from "../middleware/auth";

export const me = new Hono<AppEnv>();

me.get("/me", (c) => c.json(requireUser(c)));

/** The player's upcoming events, soonest first — the "My events" tab. */
me.get("/me/rsvps", async (c) => {
  const user = requirePlayer(c);
  return c.json(await listPlayerRsvps(c.env.DB, user.id, nowIso()));
});

/** The organizer's own upcoming events, soonest first. */
me.get("/me/hosted", async (c) => {
  const user = requireOrganizer(c);
  return c.json(await listHostedEvents(c.env.DB, user.id, nowIso()));
});
