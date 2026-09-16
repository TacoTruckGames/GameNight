/**
 * The Hono app: one Worker serving `/api/*` and the SPA from the same origin.
 *
 * Order matters here, and it reads top to bottom:
 *   1. every throw becomes the one JSON error shape;
 *   2. `/api/*` resolves the caller before any handler runs;
 *   3. the API routers;
 *   4. an explicit `/api/*` catch-all, so a typo'd endpoint gets a JSON 404
 *      rather than the SPA's index.html;
 *   5. everything else falls through to the static assets.
 */

import { Hono } from "hono";

import { apiNotFound, onError } from "./lib/errors";
import type { AppEnv } from "./lib/context";
import { attachUser } from "./middleware/auth";
import { admin } from "./routes/admin";
import { events } from "./routes/events";
import { me } from "./routes/me";
import { places } from "./routes/places";
import { rsvp } from "./routes/rsvp";
import { users } from "./routes/users";

const app = new Hono<AppEnv>();

app.onError(onError);

app.use("/api/*", attachUser);

/** Liveness only — no database, so it stays up when D1 does not. */
app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api", users);
app.route("/api", me);
app.route("/api", events);
// After `events`, because it hangs `/events/:id/map` off the same prefix and a
// reader should find the two together; before `admin`, because it is public API.
app.route("/api", places);
app.route("/api", rsvp);
// Last: nothing else claims `/api/admin/*`, and keeping it at the bottom means
// the public API's routing is unaffected by the operator surface existing.
app.route("/api", admin);

app.all("/api/*", apiNotFound);

// Safety net. In practice `run_worker_first = ["/api/*"]` means non-API
// requests are served by the asset handler before they ever reach the Worker.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
