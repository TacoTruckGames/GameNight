/**
 * The three endpoints that stand between the browser and Google.
 *
 * The browser never talks to Google directly. That is not paranoia about the
 * key alone — it is what keeps the SPA's "zero cross-origin requests" property
 * true, lets a future CSP stay `img-src 'self'` with no allowlist entry, and
 * puts the daily spend ceiling somewhere a client cannot route around.
 *
 * One behavioural rule runs through all three, and it is worth stating once:
 * **a switched-off feature is not an error.** With no key configured, `/config`
 * says so, `/suggest` returns an empty list with a 200, and the map route
 * returns a 503 that the client renders as "no map" — and none of them write to
 * the error log. An Errors page full of "no key configured" is an Errors page an
 * operator stops reading.
 */

import { Hono } from "hono";
import type { PlacesConfig, SuggestResponse } from "../../shared/api-types";
import { MAP_PRESETS, SUGGEST_MIN } from "../../shared/maps";
import { z } from "zod";

import { getEventPlace } from "../db/queries";
import type { AppEnv } from "../lib/context";
import { ApiError } from "../lib/errors";
import { chargeBudget, placesFromEnv, redact, type LocationBias, type PlacesFailure } from "../lib/places";
import { reportError } from "../lib/report";
import { parseQuery } from "../lib/validate";
import { requireOrganizerOrAdmin } from "../middleware/auth";
import { eventMapKey, previewMapKey, type MapSize } from "../lib/map-key";

export const places = new Hono<AppEnv>();

/**
 * Below this, the suggestion list is noise and every keystroke is a billed
 * request. Three characters is also where Google's own guidance lands, and with
 * a client-side debounce it is the single biggest cost lever in the feature —
 * bigger than the session token, which only starts paying at ~4.24 requests per
 * session.
 */
const SUGGEST_MAX = 120;

const MAP_MAX_AGE = 86_400; // one day in the browser
const MAP_S_MAX_AGE = 2_592_000; // thirty days at the edge — a pin does not move

// ------------------------------------------------------------ the flag --

/**
 * Two booleans rather than one, although today they are always equal: the map
 * and the autocomplete are separate SKUs with separate prices, and the first
 * cost-control lever anyone will reach for is "keep the search, drop the
 * images". A client written against one boolean would have to be rewritten for
 * that; a client written against two would not.
 *
 * Anonymous and cacheable — it says nothing about the caller, only about the
 * deployment.
 */
places.get("/places/config", (c) => {
  const configured = placesFromEnv(c.env) !== null;
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ suggest: configured, map: configured } satisfies PlacesConfig);
});

// ------------------------------------------------------------- suggest --

const suggestQuerySchema = z.object({
  q: z.string().max(SUGGEST_MAX).optional(),
  /** Google's autocomplete session token. Never validated strictly — see `shared/schemas.ts`. */
  session: z.string().max(64).optional(),
});

/**
 * Read the organizer's coarse edge location, if the runtime offers one, and
 * turn it into a bias circle.
 *
 * `request.cf` is absent under `wrangler dev` and in tests, and its fields are
 * typed as `string | undefined` even where they hold numbers, so everything
 * here is defensive. Note in the README that this sends a *coarse* location —
 * city-level, from the edge, not the device — to Google.
 */
function biasFrom(raw: Request): LocationBias | undefined {
  const cf = (raw as { cf?: Record<string, unknown> }).cf;
  if (!cf) return undefined;
  const lat = Number(cf["latitude"]);
  const lng = Number(cf["longitude"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/**
 * Proxied autocomplete, for the two roles that fill in a venue field.
 *
 * **Every degraded path is a 200 with an empty list.** Unconfigured, under the
 * minimum length, over budget, timed out, upstream down — all of them. A 501 or
 * a 503 here would make the client's *error* branch do product logic ("was that
 * a real failure or is the feature just off?") when it already knows the answer
 * from `/api/places/config`, and it would fill the Errors page with noise. Only
 * a genuine upstream failure is reported.
 */
places.get("/places/suggest", async (c) => {
  requireOrganizerOrAdmin(c);
  const { q, session } = parseQuery(c, suggestQuerySchema);

  // `private`: the suggestion list is the same for everyone, but the route is
  // authenticated, and a shared cache holding a response to an authenticated
  // request is a habit worth not forming.
  c.header("Cache-Control", "private, max-age=300");

  const empty = { suggestions: [] } satisfies SuggestResponse;

  const input = (q ?? "").trim();
  if (input.length < SUGGEST_MIN) return c.json(empty);

  const client = placesFromEnv(c.env);
  if (!client) return c.json(empty); // switched off: not an error, not reported

  // Charged before the call, so an exhausted budget costs nothing at all.
  if (!(await chargeBudget(c.env.DB, "autocomplete"))) return c.json(empty);

  const result = await client.suggest(input, { sessionToken: session, bias: biasFrom(c.req.raw) });
  if (!result.ok) {
    await reportUpstream(c.env.DB, "places.suggest", result.reason, { inputLength: input.length });
    return c.json(empty);
  }

  return c.json({ suggestions: result.value } satisfies SuggestResponse);
});

/** One line in the Errors page per distinct failure shape, already redacted. */
async function reportUpstream(
  db: D1Database,
  scope: string,
  reason: PlacesFailure,
  metadata: Record<string, unknown>,
): Promise<void> {
  await reportError(db, scope, new Error(`Google Places ${scope.split(".")[1]} failed: ${reason}`), {
    reason,
    ...metadata,
  });
}

// ----------------------------------------------------------------- map --

/**
 * The preview map, for a venue that is being typed rather than posted.
 *
 * `q` is the label the picker put in the field — Google's own formatted string
 * for a place the organizer selected — and Static Maps geocodes it inside the
 * same billed request, so a preview costs one map and no Place Details.
 *
 * **Organizer-only, and that is the whole containment story.** The event map is
 * bounded by an event id plus a `v` that must match the stored place; this one
 * takes free text, so an anonymous version of it would be an open proxy where
 * every distinct string mints a fresh billed render. Behind the same gate as
 * the picker itself the caller is someone who can already post events, the size is one of two
 * presets, `q` is capped, and the daily `static_map` ceiling still fails closed.
 */
// `strictObject`, both: an unknown query key is a 400, not a fresh cache key.
const previewMapQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200),
  w: z.string().optional(),
  h: z.string().optional(),
  scale: z.string().optional(),
});

const mapQuerySchema = z.strictObject({
  w: z.string().optional(),
  h: z.string().optional(),
  scale: z.string().optional(),
  /**
   * The event's current `place_id`. Two jobs in one parameter: it bounds how
   * many distinct cache keys a stranger can mint for one event id, and it busts
   * the 30-day edge cache the instant an admin re-points the venue.
   */
  v: z.string().max(512).optional(),
});

/**
 * The static map for one event's stored coordinates.
 *
 * Keyed by **event id**, never by `?lat=&lng=`: a lat/lng endpoint is an open
 * image proxy, and every render is billed to us. An event id bounds the
 * renderable set to venues that someone actually posted a game at, which also
 * drives the cache hit rate to nearly one.
 */
/** The one size vocabulary both map routes accept; anything else is a 400. */
function parseMapSize(w: string | undefined, h: string | undefined, scaleRaw: string | undefined): MapSize {
  const width = Number(w);
  const height = Number(h);
  const scale = scaleRaw === undefined ? 1 : Number(scaleRaw);
  const preset = MAP_PRESETS.find((size) => size.width === width && size.height === height);
  if (!preset || (scale !== 1 && scale !== 2)) {
    throw new ApiError(400, "VALIDATION_FAILED", "That map size is not one we render.");
  }
  return { width: preset.width, height: preset.height, scale: scale === 2 ? 2 : 1 };
}

places.get("/places/map", async (c) => {
  requireOrganizerOrAdmin(c);

  // Parse, then key on the values — see `worker/lib/map-key.ts`.
  const { q, w, h, scale: scaleRaw } = parseQuery(c, previewMapQuerySchema);
  const size = parseMapSize(w, h, scaleRaw);
  const cacheKey = previewMapKey(new URL(c.req.url).origin, q, size);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("X-Map-Cache", "HIT");
    return hit;
  }

  const client = placesFromEnv(c.env);
  if (!client) return unavailable();
  if (!(await chargeBudget(c.env.DB, "static_map"))) return unavailable();

  const rendered = await client.staticMap({ query: q, ...size });
  if (!rendered.ok) {
    await reportUpstream(c.env.DB, "places.map", rendered.reason, { query: redact(q).slice(0, 128) });
    return unavailable();
  }

  const headers = new Headers();
  headers.set("Content-Type", rendered.value.headers.get("Content-Type") ?? "image/png");
  headers.set("Cache-Control", `public, max-age=${MAP_MAX_AGE}, s-maxage=${MAP_S_MAX_AGE}`);
  headers.set("X-Map-Cache", "MISS");
  const response = new Response(rendered.value.body, { status: 200, headers });
  c.executionCtx.waitUntil(
    caches.default.put(cacheKey, response.clone()).catch(() => {
      /* an unwritable cache costs money, not correctness */
    }),
  );
  return response;
});

places.get("/events/:id/map", async (c) => {
  // Parsing is pure CPU, so it goes before the cache lookup and the key is
  // built from what was parsed: one key per (event, size, venue). Then, before
  // D1, before auth, before anything else, the cache — the whole cost argument
  // for this feature rests on the second request never reaching Google *or*
  // the database.
  const { w, h, scale: scaleRaw, v } = parseQuery(c, mapQuerySchema);
  const size = parseMapSize(w, h, scaleRaw);
  const cacheKey = eventMapKey(new URL(c.req.url).origin, c.req.param("id"), size, v ?? "");
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("X-Map-Cache", "HIT");
    return hit;
  }

  const row = await getEventPlace(c.env.DB, c.req.param("id"));
  // One 404 for three cases — no such event, no verified venue, stale `v` —
  // because from the client's side they are the same thing: there is no map
  // here, stop asking, and do not cache the answer.
  if (!row || row.place_id === null || row.place_lat === null || row.place_lng === null || row.place_id !== v) {
    return c.json({ error: { code: "NOT_FOUND", message: "That event has no map." } }, 404, {
      "Cache-Control": "no-store",
    });
  }

  const client = placesFromEnv(c.env);
  if (!client) return unavailable();

  if (!(await chargeBudget(c.env.DB, "static_map"))) return unavailable();

  const rendered = await client.staticMap({ lat: row.place_lat, lng: row.place_lng, ...size });
  if (!rendered.ok) {
    await reportUpstream(c.env.DB, "places.map", rendered.reason, { eventId: redact(c.req.param("id")) });
    return unavailable();
  }

  const headers = new Headers();
  headers.set("Content-Type", rendered.value.headers.get("Content-Type") ?? "image/png");
  // A day in the browser, a month at the edge: the pin for a given event and
  // size never changes, and when the venue does, `v` changes with it.
  headers.set("Cache-Control", `public, max-age=${MAP_MAX_AGE}, s-maxage=${MAP_S_MAX_AGE}`);
  headers.set("X-Map-Cache", "MISS");

  const response = new Response(rendered.value.body, { status: 200, headers });
  // `clone()` before the body is consumed by the client, and `waitUntil` so the
  // write never delays the image. A cache write failing is not worth a 500.
  c.executionCtx.waitUntil(
    caches.default.put(cacheKey, response.clone()).catch(() => {
      /* an unwritable cache costs money, not correctness */
    }),
  );
  return response;
});

/**
 * 503 and `no-store`, for every "we could have rendered this but cannot right
 * now" case. Never cached: unlike the 404, this one is expected to stop being
 * true.
 */
function unavailable(): Response {
  return new Response(
    JSON.stringify({ error: { code: "PLACE_UNAVAILABLE", message: "Maps are unavailable right now." } }),
    { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
