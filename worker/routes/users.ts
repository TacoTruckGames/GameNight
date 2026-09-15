/**
 * `GET /api/users` — the identity picker.
 * `POST /api/users` — self-signup, always a player.
 *
 * Organizers are seed-only on purpose: role assignment is the one thing a
 * trust-the-client identity model must not let the client do.
 */

import { Hono } from "hono";

import { createPlayerSchema } from "../../shared/schemas";
import { insertPlayer, listUsers } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { parseJson } from "../lib/validate";

export const users = new Hono<AppEnv>();

users.get("/users", async (c) => c.json(await listUsers(c.env.DB)));

users.post("/users", async (c) => {
  const { name } = await parseJson(c, createPlayerSchema);
  const user = await insertPlayer(c.env.DB, `u_${crypto.randomUUID()}`, name);
  return c.json(user, 201);
});
