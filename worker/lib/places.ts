/**
 * The entire Google Maps Platform surface, in one file.
 *
 * Four rules hold throughout, and they are the reason this is a module rather
 * than three `fetch` calls scattered through the routes:
 *
 * 1. **Nothing here throws at a route.** Every call returns a discriminated
 *    result (`{ ok: false, reason }`), because "Google is down" is an ordinary
 *    state of the world that each caller degrades from differently — posting an
 *    event shrugs and stores free text, an admin re-pointing a venue gets a 503.
 *    A thrown error would force both into the same branch.
 * 2. **The key never leaves this file except into a header.** The one exception
 *    is `staticMapUrl`, where the Static Maps API has no header form — which is
 *    exactly why `redact()` exists and why every string that could have come
 *    near a URL goes through it before it reaches `reportError` or a log. This
 *    is a public repository.
 * 3. **The field masks are Essentials-tier only and have no spaces.** A space in
 *    `X-Goog-FieldMask` is a 400, not a partial response; and `displayName` is a
 *    Pro-tier field that would triple the price of every lookup to obtain a
 *    string the organizer already typed into `location`.
 * 4. **The fetcher is injectable.** `@cloudflare/vitest-plugin@1.1.10` does not
 *    export `fetchMock`, so this seam is the only way to test the request shape,
 *    the failure taxonomy and the retry policy without touching the network.
 */

import type { Context } from "hono";
import type { EventPlace, PlaceSuggestion } from "../../shared/api-types";
import type { ResolvedPlace } from "../db/queries";

import type { PlaceUpdate } from "../db/queries";
import type { AppEnv } from "./context";
import { ApiError, fieldError } from "./errors";
import { reportError } from "./report";
import { nowIso } from "./time";
import { redact } from "./redact";

// ------------------------------------------------------------- the vendor --

const PLACES_ORIGIN_DEFAULT = "https://places.googleapis.com";
const STATIC_MAP_ORIGIN_DEFAULT = "https://maps.googleapis.com";

/**
 * Autocomplete's mask. Only the two fields the combobox renders: an id to send
 * back, and the two halves of the label. No spaces — see rule 3.
 */
const SUGGEST_FIELD_MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat";

/**
 * Place Details' mask. **Essentials tier.** Do not add `displayName`,
 * `googleMapsUri` or `primaryType`: each is Pro, and Pro is $17/1k against
 * Essentials' $5/1k with half the free cap.
 */
const DETAILS_FIELD_MASK = "id,formattedAddress,location";

/**
 * A keystroke's worth of patience. There is no retry on autocomplete because
 * the user's *next keystroke* is a better retry than ours: it carries fresher
 * input and it costs the same.
 */
const SUGGEST_TIMEOUT_MS = 1200;

/** One deliberate action by an organizer who has already picked. Worth waiting for. */
const DETAILS_TIMEOUT_MS = 2500;

const STATIC_MAP_TIMEOUT_MS = 4000;

/** Long enough to skip a blip, short enough that the organizer does not notice. */
const RETRY_BACKOFF_MS = 150;

/** Google returns at most 5 predictions; this is belt and braces on their promise. */
const SUGGESTION_LIMIT = 5;

/** Tight enough to read street names, wide enough to place the venue in a neighbourhood. */
const DEFAULT_ZOOM = 15;

// ------------------------------------------------------------------ types --

/**
 * Why a call did not produce an answer.
 *
 * The taxonomy is not decoration: `not_found` is the organizer's problem (the
 * place id is stale — a 400 with a field error), `quota` and `upstream` are
 * ours (a 503), and `unauthorized` is a deployment mistake that should shout in
 * the error log rather than look like an outage.
 */
export type PlacesFailure = "timeout" | "network" | "unauthorized" | "quota" | "not_found" | "upstream" | "malformed";

export type PlacesResult<T> = { ok: true; value: T } | { ok: false; reason: PlacesFailure };

/** One row in the combobox. `secondaryText` is `""` when Google omits it. */
/** What Place Details gives us, already narrowed to the four columns we store — the wire shape, exactly. */
export type PlaceDetails = EventPlace;
export type { PlaceSuggestion, ResolvedPlace };

/** A circle to prefer results near — the organizer's coarse edge location. */
export interface LocationBias {
  lat: number;
  lng: number;
  /** Metres. Google caps this at 50,000. */
  radius?: number;
}

export interface SuggestOptions {
  sessionToken?: string | undefined;
  bias?: LocationBias | undefined;
}

/**
 * Where to centre a static map, and how big.
 *
 * Two ways to say where, because there are two moments. A posted event has
 * coordinates in its row, resolved once at write time. A venue being *typed*
 * into the form has none — resolving them would mean a Place Details call per
 * preview, at 3× the price of the map itself — so the preview centres on the
 * label Google gave the picker, which the Static Maps API geocodes as part of
 * the same billed request. The two produce the byte-identical image; this was
 * checked against the live API before the second form was added.
 *
 * (`center=place_id:…` is not a third way. It answers 200 and returns a blank
 * tile — 6KB against 27KB for the same venue — which is the most expensive kind
 * of wrong: it looks like it worked.)
 */
export type StaticMapOptions = {
  width: number;
  height: number;
  scale: 1 | 2;
  zoom?: number;
} & ({ lat: number; lng: number; query?: undefined } | { query: string });

/** The seam. Narrower than `fetch` on purpose: a test double only has to be this. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface PlacesClientOptions {
  apiKey: string;
  fetcher?: Fetcher;
  /** Places API base, overridable so a test can point at a dead port. */
  origin?: string | undefined;
  /** Static Maps base. Defaults to `origin` when one is given, so one override covers both. */
  staticOrigin?: string | undefined;
  /** URL-safe base64, from the Google Cloud console. Absent ⇒ unsigned URLs. */
  signingSecret?: string | undefined;
}

// --------------------------------------------------------------- redaction --

/**
 * Strip anything that could put a credential in the error log.
 *
 * Two forms: the `key=`/`signature=` query parameters that `staticMapUrl` has to
 * build, and a bare `AIza…` key that could have been pasted into a message by
 * an upstream error body. The word-boundary on `key` does not fire inside
 * `apikey` or `sessionToken`, which is why the pattern is this shape.
 *
 * Everything heading for `reportError` or `console` goes through here.
 */
// Lives in its own module so `report.ts` can use it without importing the
// Places client; re-exported here because this is where callers look for it.
export { redact };

// ------------------------------------------------------------------ budget --

/**
 * The daily ceiling per SKU, in requests.
 *
 * These are a *braces* to the console's quota caps, not a substitute: the
 * console cap is the one a code bug cannot bypass, but it is invisible to
 * anyone reading this repository, and it cannot be seen in a test. Numbers
 * chosen to sit comfortably under Google's 10,000/month free Essentials cap
 * divided across a month, with the expensive SKU (Place Details, $5/1k) set
 * four times tighter than the cheap ones because one event creation needs
 * exactly one of them.
 */
export const BUDGET_CAPS = {
  autocomplete: 2000,
  place_details: 500,
  static_map: 2000,
} as const;

export type ApiSku = keyof typeof BUDGET_CAPS;

/** `YYYY-MM-DD`, UTC — the same day boundary the caps are written against. */
export function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Charge one request against today's budget for `sku`.
 *
 * Increment-then-check, in a single statement, so two concurrent requests
 * cannot both read "1,999" and both spend. `RETURNING count` is what makes it
 * one round trip rather than a read and a write with a race between them.
 *
 * **Fails closed.** If the counter cannot be written we do not know what we
 * have spent, and this exists precisely to bound spending we cannot see. The
 * cost of being wrong is a missing map; the cost of failing open is a bill.
 */
export async function chargeBudget(db: D1Database, sku: ApiSku, now: Date = new Date()): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO api_usage (day, sku, count) VALUES (?1, ?2, 1)
         ON CONFLICT(day, sku) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(usageDay(now), sku)
      .first<{ count: number }>();
    return (row?.count ?? Number.MAX_SAFE_INTEGER) <= BUDGET_CAPS[sku];
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- the client --

/**
 * A session token is a billing hint, never a correctness input, so an
 * unrecognisable one is dropped rather than rejected: no organizer should ever
 * fail to post an event because a uuid generator misbehaved.
 */
function cleanSessionToken(token: string | undefined | null): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

type Sent = { ok: true; response: Response } | { ok: false; reason: "timeout" | "network" };

async function send(fetcher: Fetcher, url: string, init: RequestInit, timeoutMs: number): Promise<Sent> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, response };
  } catch (error) {
    // Nothing else can reach here: a non-2xx is a resolved promise, so the only
    // rejections are "the socket never happened" and "we gave up waiting".
    return { ok: false, reason: isTimeout(error) ? "timeout" : "network" };
  }
}

/**
 * Turn a non-2xx into a reason.
 *
 * Google signals an exhausted quota two ways — a bare `429`, and a `403` whose
 * body carries `error.status: "RESOURCE_EXHAUSTED"` — and the second must not
 * read as "the key is wrong", or an operator will go and regenerate a
 * perfectly good key. The body read is best-effort; a failure to parse falls
 * back to the status code.
 */
async function classify(response: Response): Promise<PlacesFailure> {
  let status: string | null = null;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const error = (parsed as { error?: { status?: unknown } } | null)?.error;
    if (typeof error?.status === "string") status = error.status;
  } catch {
    /* an unparseable error body tells us nothing the status code does not */
  }

  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") return "quota";
  if (response.status === 401 || response.status === 403) return "unauthorized";
  if (response.status === 404 || status === "NOT_FOUND") return "not_found";
  return "upstream";
}

/** Drain a response we are about to discard, so the connection can be reused. */
async function discard(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    /* nothing to do with a body we were throwing away anyway */
  }
}

function toSuggestions(payload: unknown): PlaceSuggestion[] | null {
  const raw = (payload as { suggestions?: unknown } | null)?.suggestions;
  // An empty result set comes back as `{}` with no `suggestions` key at all —
  // that is "no matches", not a malformed response.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const out: PlaceSuggestion[] = [];
  for (const entry of raw) {
    const prediction = (entry as { placePrediction?: unknown } | null)?.placePrediction as
      | {
          placeId?: unknown;
          structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
        }
      | undefined;
    const placeId = prediction?.placeId;
    const primary = prediction?.structuredFormat?.mainText?.text;
    // Query predictions (which we ask Google not to send) have no `placeId`;
    // skip anything unusable rather than failing the whole list over one row.
    if (typeof placeId !== "string" || placeId === "" || typeof primary !== "string") continue;
    const secondary = prediction?.structuredFormat?.secondaryText?.text;
    out.push({
      placeId,
      primaryText: primary,
      secondaryText: typeof secondary === "string" ? secondary : "",
    });
    if (out.length === SUGGESTION_LIMIT) break;
  }
  return out;
}

function toDetails(payload: unknown): PlaceDetails | null {
  const body = payload as
    | { id?: unknown; formattedAddress?: unknown; location?: { latitude?: unknown; longitude?: unknown } }
    | null;
  const id = body?.id;
  const address = body?.formattedAddress;
  const lat = body?.location?.latitude;
  const lng = body?.location?.longitude;
  if (typeof id !== "string" || id === "") return null;
  if (typeof address !== "string" || address === "") return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  return { id, address, lat, lng };
}

async function readJson(response: Response): Promise<unknown | undefined> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------------- signing --

function fromUrlSafeBase64(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function toUrlSafeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Google's Static Maps URL signature: HMAC-SHA1 over the **path and query
 * only**, keyed by the URL-safe-base64 secret decoded to bytes, emitted as
 * URL-safe base64 and appended as `&signature=`.
 *
 * SHA-1 is restricted for RSA/ECDSA in workerd but permitted for HMAC —
 * verified on `compatibility_date = "2026-09-01"`, against Google's own
 * documented test vector (see `test/unit/places.test.ts`).
 */
export async function signStaticMapUrl(url: URL, signingSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromUrlSafeBase64(signingSecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${url.pathname}${url.search}`));
  return toUrlSafeBase64(new Uint8Array(signature));
}

// ----------------------------------------------------------------- client --

export interface PlacesClient {
  suggest(input: string, options?: SuggestOptions): Promise<PlacesResult<PlaceSuggestion[]>>;
  details(placeId: string, options?: { sessionToken?: string | undefined }): Promise<PlacesResult<PlaceDetails>>;
  /** The one URL in the codebase that carries the API key. Never log it unredacted. */
  staticMapUrl(options: StaticMapOptions): Promise<string>;
  staticMap(options: StaticMapOptions): Promise<PlacesResult<Response>>;
}

export function createPlacesClient(options: PlacesClientOptions): PlacesClient {
  const { apiKey } = options;
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const origin = (options.origin ?? PLACES_ORIGIN_DEFAULT).replace(/\/+$/, "");
  const staticOrigin = (options.staticOrigin ?? options.origin ?? STATIC_MAP_ORIGIN_DEFAULT).replace(/\/+$/, "");
  const signingSecret = options.signingSecret;

  async function staticMapUrl(map: StaticMapOptions): Promise<string> {
    const center = map.query === undefined ? `${map.lat},${map.lng}` : map.query;
    const url = new URL(`${staticOrigin}/maps/api/staticmap`);
    url.searchParams.set("center", center);
    url.searchParams.set("zoom", String(map.zoom ?? DEFAULT_ZOOM));
    url.searchParams.set("size", `${map.width}x${map.height}`);
    url.searchParams.set("scale", String(map.scale));
    url.searchParams.set("markers", `color:red|${center}`);
    url.searchParams.set("key", apiKey);
    if (!signingSecret) return url.toString();
    // Appended raw rather than through `searchParams`, because the signature is
    // over the query string as it will be sent and re-encoding it would break it.
    return `${url.toString()}&signature=${await signStaticMapUrl(url, signingSecret)}`;
  }

  return {
    staticMapUrl,

    async suggest(input, suggestOptions = {}) {
      const body: Record<string, unknown> = {
        input,
        // We render a place picker, not a search box: a query prediction has no
        // place id, so it could never be resolved into coordinates.
        includeQueryPredictions: false,
      };
      const sessionToken = cleanSessionToken(suggestOptions.sessionToken);
      if (sessionToken) body["sessionToken"] = sessionToken;
      const bias = suggestOptions.bias;
      if (bias) {
        body["locationBias"] = {
          circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: bias.radius ?? 50000 },
        };
      }

      // No retry, by design — see `SUGGEST_TIMEOUT_MS`.
      const sent = await send(
        fetcher,
        `${origin}/v1/places:autocomplete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": SUGGEST_FIELD_MASK,
          },
          body: JSON.stringify(body),
        },
        SUGGEST_TIMEOUT_MS,
      );
      if (!sent.ok) return { ok: false, reason: sent.reason };
      if (!sent.response.ok) return { ok: false, reason: await classify(sent.response) };

      const suggestions = toSuggestions(await readJson(sent.response));
      return suggestions === null ? { ok: false, reason: "malformed" } : { ok: true, value: suggestions };
    },

    async details(placeId, detailOptions = {}) {
      const url = new URL(`${origin}/v1/places/${encodeURIComponent(placeId)}`);
      const sessionToken = cleanSessionToken(detailOptions.sessionToken);
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

      // Exactly one retry, and only for the two failures that a second attempt
      // can plausibly fix. A 4xx will be a 4xx again, and retrying a 429 is how
      // a quota problem becomes a quota problem twice as fast.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const first = attempt === 0;
        const sent = await send(
          fetcher,
          url.toString(),
          { method: "GET", headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAILS_FIELD_MASK } },
          DETAILS_TIMEOUT_MS,
        );

        if (!sent.ok) {
          // A timeout is not retried: we already spent the caller's patience.
          if (sent.reason === "network" && first) {
            await sleep(RETRY_BACKOFF_MS);
            continue;
          }
          return { ok: false, reason: sent.reason };
        }

        const response = sent.response;
        if (response.status >= 500 && first) {
          await discard(response);
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        if (!response.ok) return { ok: false, reason: await classify(response) };

        const details = toDetails(await readJson(response));
        return details === null ? { ok: false, reason: "malformed" } : { ok: true, value: details };
      }
      /* c8 ignore next -- the loop always returns or continues exactly once */
      return { ok: false, reason: "upstream" };
    },

    async staticMap(map) {
      const sent = await send(fetcher, await staticMapUrl(map), { method: "GET" }, STATIC_MAP_TIMEOUT_MS);
      if (!sent.ok) return { ok: false, reason: sent.reason };
      if (!sent.response.ok) {
        const reason = await classify(sent.response);
        return { ok: false, reason };
      }
      return { ok: true, value: sent.response };
    },
  };
}

// ------------------------------------------------------------- the switch --

/**
 * **The feature flag.** `null` means "no key configured", which is a supported
 * deployment — it is what every reviewer who clones this repository gets — and
 * the single place the whole feature switches off.
 *
 * Deliberately not `Boolean(env.GOOGLE_MAPS_API_KEY)`: a `.dev.vars` line left
 * as `GOOGLE_MAPS_API_KEY=` would otherwise read as configured and turn every
 * lookup into an `unauthorized` in the error log.
 */
export function placesFromEnv(env: Env, fetcher?: Fetcher): PlacesClient | null {
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;
  return createPlacesClient({
    apiKey,
    origin: env.PLACES_ORIGIN?.trim() || undefined,
    signingSecret: env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined,
    ...(fetcher ? { fetcher } : {}),
  });
}

/**
 * "The feature is switched off" is not a failure, and must never reach the
 * error log — an admin Errors page full of "no key configured" trains an
 * operator to ignore it, which is the only way an error log can actually fail.
 */
export type PlaceResolution =
  | { ok: true; place: ResolvedPlace }
  | { ok: false; reason: PlacesFailure | "unconfigured" };

/**
 * Resolve a client-supplied place id into the four columns we store, charging
 * the budget first.
 *
 * This is the "verified" in verified venue: the client sends an opaque id and
 * nothing else, and every value that lands in the database came back from
 * Google in this call. A client-supplied latitude is not evidence of anything.
 */
export async function resolvePlaceId(
  env: Env,
  db: D1Database,
  placeId: string,
  sessionToken?: string | undefined,
): Promise<PlaceResolution> {
  const client = placesFromEnv(env);
  if (!client) return { ok: false, reason: "unconfigured" };
  if (!(await chargeBudget(db, "place_details"))) return { ok: false, reason: "quota" };

  const result = await client.details(placeId, { sessionToken });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, place: { ...result.value, resolvedAt: nowIso() } };
}

/**
 * **This is where an edit refuses to lie.**
 *
 * `POST /api/events` degrades silently when Google is unreachable: the
 * organizer wanted to post a game and the map is a garnish, so the event is
 * created with no place and the UI says so in one line. *Editing* a venue is
 * doing only that, deliberately, on a screen opened to fix a wrong one —
 * whether the hand on it is the owning organizer's or an operator's. Returning
 * 200 with the old coordinates still in the row would say the fix landed when
 * it did not, and they would close the tab.
 *
 * So the asymmetry is exact, and it is three cases:
 *   - `placeId: null`     → unlink. No network call; clearing always works.
 *   - `not_found`         → 400 on the `placeId` field. The id is stale; that is
 *                           the caller's problem, and it is actionable.
 *   - anything else       → 503 `PLACE_UNAVAILABLE`, nothing written. Ours.
 *
 * `undefined` (the field absent) means "not editing the venue" and is the only
 * path that touches neither the network nor the place columns.
 */
export async function resolvePlaceForPatch(
  c: Context<AppEnv>,
  placeId: string | null | undefined,
  sessionToken: string | undefined,
): Promise<PlaceUpdate | null> {
  if (placeId === undefined) return null;
  if (placeId === null) return { kind: "clear" };

  const outcome = await resolvePlaceId(c.env, c.env.DB, placeId, sessionToken);
  if (outcome.ok) return { kind: "set", place: outcome.place };

  if (outcome.reason === "not_found") {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Please fix the highlighted fields.",
      fieldError("placeId", "Google no longer recognises that place. Search for the venue again."),
    );
  }

  // "No key configured" is not a failure and never reaches the Errors page —
  // but it is still a 503 here, because nothing was written and saying
  // otherwise would be the lie this whole function exists to avoid.
  if (outcome.reason !== "unconfigured") {
    await reportError(c.env.DB, "places.details", new Error(`Place lookup failed: ${outcome.reason}`), {
      reason: outcome.reason,
      placeId: redact(placeId).slice(0, 128),
    });
  }

  throw new ApiError(
    503,
    "PLACE_UNAVAILABLE",
    "We couldn't confirm that venue just now, so nothing was changed. Try again in a moment.",
  );
}
