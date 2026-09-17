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
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

import { ApiError, apiNotFound, onError } from "./lib/errors";
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

// The API's own headers. The SPA's come from `public/_headers`, because
// `run_worker_first = ["/api/*"]` means the asset handler answers everything
// else without this code running. JSON never executes, so the policy here is
// the strict one: nothing may embed it, nothing may sniff it.
app.use(
  "/api/*",
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    xFrameOptions: "DENY",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

// 16 KB is ten times the largest body this API accepts (a 500-character
// description with a title, a location and a place token). Without it,
// `c.req.json()` reads the whole request before zod sees a byte.
const BODY_LIMIT = 16 * 1024;
app.use(
  "/api/*",
  bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) => c.json(new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.").toBody(), 413),
  }),
);

// Anything answered *to someone* must not be cached for anyone else. Routes
// that set their own policy keep it — the map routes are `public` on purpose.
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.header("X-User-Id") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

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
