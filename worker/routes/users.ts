/**
 * `GET /api/users` — the identity picker.
 * `POST /api/users` — self-signup as either role.
 *
 * The caller chooses the role because the picker already lets anyone sign in as
 * a seeded organizer: there is no privilege boundary here to defend, only a
 * demo board to get into. Role *permissions* are still enforced server-side on
 * every other route — see `middleware/auth.ts`.
 */

import { Hono } from "hono";

import { createUserSchema, usersQuerySchema } from "../../shared/schemas";
import { insertUser, listUsers } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { parseJson, parseQuery } from "../lib/validate";

export const users = new Hono<AppEnv>();

// `?role=` and `?limit=` (default 50, max 200): the picker asks for one role's
// first fifty, the operator tools for the one admin, a script for what it
// needs — nobody gets the table.
users.get("/users", async (c) => c.json(await listUsers(c.env.DB, parseQuery(c, usersQuerySchema))));

users.post("/users", async (c) => {
  const { name, role } = await parseJson(c, createUserSchema);
  // Same id shape the seed uses, so a hand-read `rsvps` row still tells you
  // which side of the board a row came from.
  const id = `${role === "organizer" ? "org" : "u"}_${crypto.randomUUID()}`;
  const user = await insertUser(c.env.DB, id, name, role);
  return c.json(user, 201);
});
