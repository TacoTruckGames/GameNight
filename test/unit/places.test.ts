/**
 * `worker/lib/places.ts` — the vendor surface, with the network replaced.
 *
 * The injectable `fetcher` is not a convenience: `@cloudflare/vitest-plugin`
 * 1.1.10 declares undici's `Mock*` types but exports no `fetchMock` binding, so
 * a seam in our own code is the only way to assert on a request that never
 * leaves the process. Everything below runs offline, with no key, in under a
 * millisecond of wall clock.
 *
 * What is worth asserting here, and why:
 *   - the **exact field masks**, because a space in one is a 400 rather than a
 *     partial response, and because `displayName` slipping into the Place
 *     Details mask would silently move every lookup to the Pro SKU at 3.4× the
 *     price and half the free cap;
 *   - the **failure taxonomy**, because three callers degrade from it in three
 *     different directions;
 *   - the **retry policy**, because retrying a 429 is how a quota problem
 *     becomes a quota problem twice as fast;
 *   - **`redact()`**, because this is a public repository and the Static Maps
 *     API has no header form for its key.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { mapsDirectionsUrl, mapsSearchUrl } from "../../shared/maps-links";
import { toEventSummary, type EventRow } from "../../worker/db/queries";
import {
  BUDGET_CAPS,
  chargeBudget,
  createPlacesClient,
  placesFromEnv,
  redact,
  signStaticMapUrl,
  usageDay,
  type Fetcher,
} from "../../worker/lib/places";

// ------------------------------------------------------------- the double --

interface Call {
  url: string;
  init: RequestInit;
}

/**
 * A fetcher that replays `makers` in order (the last one repeats), recording
 * every call. Factories rather than `Response` values because a retry test
 * needs a *fresh* body each attempt.
 */
function queued(...makers: Array<() => Response>): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetcher: Fetcher = (url, init) => {
    calls.push({ url, init: init ?? {} });
    const make = makers[Math.min(index, makers.length - 1)]!;
    index += 1;
    return Promise.resolve(make());
  };
  return { fetcher, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function thrower(name: string): () => Response {
  return () => {
    throw Object.assign(new Error(`synthetic ${name}`), { name });
  };
}

function client(fetcher: Fetcher, options: { signingSecret?: string } = {}) {
  return createPlacesClient({
    apiKey: "test-key",
    fetcher,
    origin: "https://places.test",
    ...(options.signingSecret ? { signingSecret: options.signingSecret } : {}),
  });
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

const PREDICTION = {
  placePrediction: {
    placeId: "place-central",
    structuredFormat: { mainText: { text: "Central Library" }, secondaryText: { text: "1000 4th Ave, Seattle" } },
  },
};

// ---------------------------------------------------------------- suggest --

describe("places.suggest — request shape", () => {
  it("POSTs to places:autocomplete with the key in a header, never a URL", async () => {
    const { fetcher, calls } = queued(() => json({ suggestions: [PREDICTION] }));
    await client(fetcher).suggest("central lib");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://places.test/v1/places:autocomplete");
    expect(calls[0]!.init.method).toBe("POST");
    expect(headersOf(calls[0]!)["X-Goog-Api-Key"]).toBe("test-key");
    // The key must never be in the URL for this SKU — only Static Maps has to.
    expect(calls[0]!.url).not.toContain("test-key");
  });

  it("asks for exactly the two prediction fields, with no spaces in the mask", () => {
    const { fetcher, calls } = queued(() => json({}));
    return client(fetcher)
      .suggest("central lib")
      .then(() => {
        const mask = headersOf(calls[0]!)["X-Goog-FieldMask"]!;
        expect(mask).toBe("suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat");
        // A single space anywhere in a field mask is a 400, not a partial response.
        expect(mask).not.toMatch(/\s/);
      });
  });

  it("turns off query predictions — they carry no place id, so they could never resolve", async () => {
    const { fetcher, calls } = queued(() => json({}));
    await client(fetcher).suggest("central lib");
    expect(bodyOf(calls[0]!)).toMatchObject({ input: "central lib", includeQueryPredictions: false });
  });

  it("sends a session token when given one, and omits the key entirely when not", async () => {
    const withToken = queued(() => json({}));
    await client(withToken.fetcher).suggest("central lib", { sessionToken: "abc-123_XYZ" });
    expect(bodyOf(withToken.calls[0]!)["sessionToken"]).toBe("abc-123_XYZ");

    const without = queued(() => json({}));
    await client(without.fetcher).suggest("central lib");
    expect(bodyOf(without.calls[0]!)).not.toHaveProperty("sessionToken");
  });

  it("drops a malformed session token rather than failing the request", async () => {
    // A billing hint must never be the reason a lookup fails. Each of these is
    // dropped: wrong charset, too long, and empty after trimming.
    for (const token of ["not a token!", "x".repeat(65), "   "]) {
      const { fetcher, calls } = queued(() => json({}));
      const result = await client(fetcher).suggest("central lib", { sessionToken: token });
      expect(result.ok).toBe(true);
      expect(bodyOf(calls[0]!)).not.toHaveProperty("sessionToken");
    }
  });

  it("sends a location bias as a circle when the edge offered one", async () => {
    const { fetcher, calls } = queued(() => json({}));
    await client(fetcher).suggest("central lib", { bias: { lat: 47.6, lng: -122.3 } });
    expect(bodyOf(calls[0]!)["locationBias"]).toEqual({
      circle: { center: { latitude: 47.6, longitude: -122.3 }, radius: 50000 },
    });
  });
});

describe("places.suggest — response mapping", () => {
  it("flattens Google's nesting into { placeId, primaryText, secondaryText }", async () => {
    const { fetcher } = queued(() => json({ suggestions: [PREDICTION] }));
    const result = await client(fetcher).suggest("central lib");

    expect(result).toEqual({
      ok: true,
      value: [{ placeId: "place-central", primaryText: "Central Library", secondaryText: "1000 4th Ave, Seattle" }],
    });
  });

  it("treats a missing secondaryText as empty, and an absent suggestions key as no matches", async () => {
    const bare = queued(() =>
      json({ suggestions: [{ placePrediction: { placeId: "p1", structuredFormat: { mainText: { text: "Only" } } } }] }),
    );
    expect(await client(bare.fetcher).suggest("only")).toEqual({
      ok: true,
      value: [{ placeId: "p1", primaryText: "Only", secondaryText: "" }],
    });

    // Google returns `{}` — not `{suggestions: []}` — when nothing matches.
    const none = queued(() => json({}));
    expect(await client(none.fetcher).suggest("zzzzzz")).toEqual({ ok: true, value: [] });
  });

  it("skips unusable rows instead of failing the whole list", async () => {
    const { fetcher } = queued(() =>
      json({
        suggestions: [
          { queryPrediction: { text: { text: "pizza near me" } } }, // no place id
          { placePrediction: { placeId: "p2", structuredFormat: { mainText: { text: "Good" } } } },
          { placePrediction: { placeId: "", structuredFormat: { mainText: { text: "Empty id" } } } },
        ],
      }),
    );
    const result = await client(fetcher).suggest("p");
    expect(result.ok && result.value.map((s) => s.placeId)).toEqual(["p2"]);
  });

  it("caps the list at five even if Google ever sends more", async () => {
    const { fetcher } = queued(() =>
      json({
        suggestions: Array.from({ length: 9 }, (_, i) => ({
          placePrediction: { placeId: `p${i}`, structuredFormat: { mainText: { text: `Place ${i}` } } },
        })),
      }),
    );
    const result = await client(fetcher).suggest("place");
    expect(result.ok && result.value).toHaveLength(5);
  });

  it("reports a non-array suggestions field as malformed, not as an empty list", async () => {
    const { fetcher } = queued(() => json({ suggestions: "nope" }));
    expect(await client(fetcher).suggest("x y z")).toEqual({ ok: false, reason: "malformed" });
  });
});

// ---------------------------------------------------------------- details --

const DETAILS_BODY = {
  id: "place-moved",
  formattedAddress: "1000 4th Ave, Seattle, WA 98104, USA",
  location: { latitude: 47.6067, longitude: -122.3325 },
};

describe("places.details", () => {
  it("GETs the place with the Essentials-only field mask — never displayName", async () => {
    const { fetcher, calls } = queued(() => json(DETAILS_BODY));
    await client(fetcher).details("place-asked");

    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://places.test/v1/places/place-asked");
    const mask = headersOf(calls[0]!)["X-Goog-FieldMask"]!;
    expect(mask).toBe("id,formattedAddress,location");
    expect(mask).not.toMatch(/\s/);
    // The regression that would matter financially: Pro-tier fields.
    expect(mask).not.toContain("displayName");
    expect(mask).not.toContain("googleMapsUri");
    expect(mask).not.toContain("primaryType");
  });

  it("puts the session token in the query string, and percent-encodes the place id", async () => {
    const { fetcher, calls } = queued(() => json(DETAILS_BODY));
    await client(fetcher).details("odd/id?x", { sessionToken: "tok-1" });
    expect(calls[0]!.url).toBe("https://places.test/v1/places/odd%2Fid%3Fx?sessionToken=tok-1");

    const without = queued(() => json(DETAILS_BODY));
    await client(without.fetcher).details("plain");
    expect(without.calls[0]!.url).not.toContain("sessionToken");
  });

  it("stores the id Google RETURNED, not the one we asked for", async () => {
    // Google re-points a merged or moved place at a new id. Storing the request
    // id would leave us holding one that resolves to nothing tomorrow.
    const { fetcher } = queued(() => json(DETAILS_BODY));
    const result = await client(fetcher).details("place-asked");

    expect(result).toEqual({
      ok: true,
      value: { id: "place-moved", address: "1000 4th Ave, Seattle, WA 98104, USA", lat: 47.6067, lng: -122.3325 },
    });
  });

  it("maps Google's {latitude, longitude} onto our {lat, lng}", async () => {
    const { fetcher } = queued(() => json(DETAILS_BODY));
    const result = await client(fetcher).details("p");
    expect(result.ok && result.value.lat).toBe(47.6067);
    expect(result.ok && result.value.lng).toBe(-122.3325);
  });

  it.each([
    ["no id", { formattedAddress: "a", location: { latitude: 1, longitude: 2 } }],
    ["no address", { id: "p", location: { latitude: 1, longitude: 2 } }],
    ["no location", { id: "p", formattedAddress: "a" }],
    ["string coordinates", { id: "p", formattedAddress: "a", location: { latitude: "1", longitude: "2" } }],
    ["not json at all", null],
  ])("calls a response with %s malformed", async (_label, body) => {
    const { fetcher } = queued(() => (body === null ? new Response("<html>502</html>", { status: 200 }) : json(body)));
    expect(await client(fetcher).details("p")).toEqual({ ok: false, reason: "malformed" });
  });
});

// ------------------------------------------------------- failure taxonomy --

describe("places — the failure taxonomy", () => {
  it.each([
    ["a 401", () => json({ error: { status: "UNAUTHENTICATED" } }, 401), "unauthorized"],
    ["a 403", () => json({ error: { status: "PERMISSION_DENIED" } }, 403), "unauthorized"],
    ["a 429", () => json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429), "quota"],
    ["a 403 carrying RESOURCE_EXHAUSTED", () => json({ error: { status: "RESOURCE_EXHAUSTED" } }, 403), "quota"],
    ["a 404", () => json({ error: { status: "NOT_FOUND" } }, 404), "not_found"],
    ["a 400", () => json({ error: { status: "INVALID_ARGUMENT" } }, 400), "upstream"],
    ["a 503", () => json({ error: {} }, 503), "upstream"],
  ])("maps %s to %s", async (_label, make, reason) => {
    // `suggest` never retries, so one maker is the whole story for it.
    expect(await client(queued(make).fetcher).suggest("abc")).toEqual({ ok: false, reason });
  });

  it("distinguishes a quota 403 from an unauthorized one, so nobody regenerates a good key", async () => {
    const quota = queued(() => json({ error: { status: "RESOURCE_EXHAUSTED" } }, 403));
    const denied = queued(() => json({ error: { status: "PERMISSION_DENIED" } }, 403));

    expect(await client(quota.fetcher).suggest("abc")).toEqual({ ok: false, reason: "quota" });
    expect(await client(denied.fetcher).suggest("abc")).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("falls back to the status code when the error body is unparseable", async () => {
    const { fetcher } = queued(() => new Response("gateway timeout", { status: 429 }));
    expect(await client(fetcher).suggest("abc")).toEqual({ ok: false, reason: "quota" });
  });

  it("separates a timeout from a dead socket", async () => {
    expect(await client(queued(thrower("TimeoutError")).fetcher).suggest("abc")).toEqual({
      ok: false,
      reason: "timeout",
    });
    expect(await client(queued(thrower("TypeError")).fetcher).suggest("abc")).toEqual({
      ok: false,
      reason: "network",
    });
  });
});

// ---------------------------------------------------------- retry policy --

describe("places — retry policy", () => {
  it("retries a 5xx on details exactly once, and succeeds on the second attempt", async () => {
    const { fetcher, calls } = queued(
      () => json({ error: {} }, 500),
      () => json(DETAILS_BODY),
    );
    const result = await client(fetcher).details("p");

    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
  });

  it("gives up after the one retry", async () => {
    const { fetcher, calls } = queued(() => json({ error: {} }, 502));
    expect(await client(fetcher).details("p")).toEqual({ ok: false, reason: "upstream" });
    expect(calls).toHaveLength(2);
  });

  it("retries a dead socket once, but never a timeout", async () => {
    const network = queued(thrower("TypeError"));
    expect(await client(network.fetcher).details("p")).toEqual({ ok: false, reason: "network" });
    expect(network.calls).toHaveLength(2);

    // A timeout has already spent the caller's patience; doubling it is worse
    // than failing.
    const timeout = queued(thrower("TimeoutError"));
    expect(await client(timeout.fetcher).details("p")).toEqual({ ok: false, reason: "timeout" });
    expect(timeout.calls).toHaveLength(1);
  });

  it.each([
    ["a 429", 429],
    ["a 404", 404],
    ["a 400", 400],
  ])("never retries %s — a second attempt cannot change the answer", async (_label, status) => {
    const { fetcher, calls } = queued(() => json({ error: {} }, status));
    await client(fetcher).details("p");
    expect(calls).toHaveLength(1);
  });

  it("never retries suggest at all — the next keystroke is the better retry", async () => {
    for (const status of [500, 503]) {
      const { fetcher, calls } = queued(() => json({ error: {} }, status));
      await client(fetcher).suggest("abc");
      expect(calls).toHaveLength(1);
    }

    const dead = queued(thrower("TypeError"));
    await client(dead.fetcher).suggest("abc");
    expect(dead.calls).toHaveLength(1);
  });
});

// -------------------------------------------------------------- redaction --

describe("redact", () => {
  it("strips the two query parameters that can carry a credential", () => {
    const url =
      "https://maps.googleapis.com/maps/api/staticmap?center=1,2&key=AIzaSyFAKEFAKEFAKEFAKE123&signature=abcDEF-_=";
    const clean = redact(url);

    expect(clean).not.toContain("AIzaSyFAKEFAKEFAKEFAKE123");
    expect(clean).not.toContain("abcDEF-_=");
    expect(clean).toContain("key=REDACTED");
    expect(clean).toContain("signature=REDACTED");
    // Everything that is not a secret survives, or the log stops being useful.
    expect(clean).toContain("center=1,2");
  });

  it("catches a bare key that leaked into a message body", () => {
    expect(redact("upstream said: bad key AIzaSyD-1234567890abcdef")).toBe("upstream said: bad key AIzaREDACTED");
  });

  it("does not eat things that merely end in 'key'", () => {
    // `\b` does not fire inside `apikey`, and `sessionToken` has no `key=` at all.
    expect(redact("apikey=abc&sessionToken=xyz")).toBe("apikey=abc&sessionToken=xyz");
  });

  it("leaves a string with nothing to hide untouched", () => {
    expect(redact("Place lookup failed: timeout")).toBe("Place lookup failed: timeout");
  });
});

// ------------------------------------------------------------- static map --

describe("staticMapUrl", () => {
  it("builds the documented Static Maps URL, with the key in the query (the one exception)", async () => {
    const url = new URL(
      await client(queued(() => json({})).fetcher).staticMapUrl({
        lat: 47.6067,
        lng: -122.3325,
        width: 640,
        height: 320,
        scale: 2,
      }),
    );

    expect(url.pathname).toBe("/maps/api/staticmap");
    expect(url.searchParams.get("center")).toBe("47.6067,-122.3325");
    expect(url.searchParams.get("size")).toBe("640x320");
    expect(url.searchParams.get("scale")).toBe("2");
    expect(url.searchParams.get("markers")).toBe("color:red|47.6067,-122.3325");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("zoom")).toBe("15");
    // …and it is exactly why `redact` exists.
    expect(redact(url.toString())).not.toContain("test-key");
  });

  it("is unsigned when no signing secret is configured", async () => {
    const url = await client(queued(() => json({})).fetcher).staticMapUrl({
      lat: 1,
      lng: 2,
      width: 320,
      height: 180,
      scale: 1,
    });
    expect(url).not.toContain("signature=");
  });

  it("appends a signature when one is", async () => {
    const url = await client(queued(() => json({})).fetcher, {
      signingSecret: "vNIXE0xscrmjlyV-12Nj_BvUPaw=",
    }).staticMapUrl({ lat: 1, lng: 2, width: 320, height: 180, scale: 1 });

    expect(url).toMatch(/&signature=[A-Za-z0-9_=-]+$/);
  });

  /**
   * Google's own documented vector. It proves three things at once: that
   * workerd permits HMAC with SHA-1 (it is restricted for RSA/ECDSA, which is
   * what the open question was about), that the secret is decoded from
   * URL-safe base64 before use rather than hashed as text, and that the digest
   * is re-encoded URL-safe.
   */
  it("matches Google's published HMAC-SHA1 signing vector", async () => {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json?address=New+York&client=clientID");
    expect(await signStaticMapUrl(url, "vNIXE0xscrmjlyV-12Nj_BvUPaw=")).toBe("chaRF2hTJKOScPr-RQCEhZbSzIE=");
  });

  it("fetches the rendered image and hands the Response back untouched", async () => {
    const { fetcher, calls } = queued(
      () => new Response("PNG-BYTES", { status: 200, headers: { "Content-Type": "image/png" } }),
    );
    const result = await client(fetcher).staticMap({ lat: 1, lng: 2, width: 640, height: 320, scale: 2 });

    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toContain("/maps/api/staticmap");
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.headers.get("Content-Type")).toBe("image/png");
    expect(result.ok && new TextDecoder().decode(await result.value.arrayBuffer())).toBe("PNG-BYTES");
  });

  it.each([
    ["a quota 429", () => json({ error: {} }, 429), "quota"],
    ["a dead socket", thrower("TypeError"), "network"],
    ["a timeout", thrower("TimeoutError"), "timeout"],
  ])("turns %s into %s rather than a broken <img>", async (_label, make, reason) => {
    const result = await client(queued(make).fetcher).staticMap({
      lat: 1,
      lng: 2,
      width: 320,
      height: 180,
      scale: 1,
    });
    expect(result).toEqual({ ok: false, reason });
  });

  it("never retries a map render — an image is not worth a second billed attempt", async () => {
    const { fetcher, calls } = queued(() => json({ error: {} }, 500));
    await client(fetcher).staticMap({ lat: 1, lng: 2, width: 320, height: 180, scale: 1 });
    expect(calls).toHaveLength(1);
  });

  it("signs the path and query only — not the origin", async () => {
    const a = new URL("https://maps.googleapis.com/maps/api/staticmap?center=1,2");
    const b = new URL("https://elsewhere.example/maps/api/staticmap?center=1,2");
    expect(await signStaticMapUrl(a, "c2VjcmV0")).toBe(await signStaticMapUrl(b, "c2VjcmV0"));
  });
});

// ----------------------------------------------------------- the feature flag --

describe("placesFromEnv", () => {
  it("is null with no key, and null for a key that is only whitespace", () => {
    expect(placesFromEnv({} as Env)).toBeNull();
    // The specific trap: a `.dev.vars` line left as `GOOGLE_MAPS_API_KEY=`.
    expect(placesFromEnv({ GOOGLE_MAPS_API_KEY: "   " } as Env)).toBeNull();
    expect(placesFromEnv({ GOOGLE_MAPS_API_KEY: "" } as Env)).toBeNull();
  });

  it("is a client once a key is present", () => {
    expect(placesFromEnv({ GOOGLE_MAPS_API_KEY: "k" } as Env)).not.toBeNull();
  });
});

// ------------------------------------------------------------------ budget --

describe("chargeBudget", () => {
  /** A day of its own per test: the suite shares one D1, and `api_usage` is global. */
  function ownDay(): Date {
    return new Date(Date.UTC(2000, 0, 1 + Math.floor(Math.random() * 9000)));
  }

  it("counts up from one and reports under-cap", async () => {
    const day = ownDay();
    expect(await chargeBudget(env.DB, "place_details", day)).toBe(true);
    expect(await chargeBudget(env.DB, "place_details", day)).toBe(true);

    const row = await env.DB.prepare("SELECT count FROM api_usage WHERE day = ?1 AND sku = ?2")
      .bind(usageDay(day), "place_details")
      .first<{ count: number }>();
    expect(row?.count).toBe(2);
  });

  it("allows exactly the cap and refuses the one after it", async () => {
    const day = ownDay();
    await env.DB.prepare("INSERT INTO api_usage (day, sku, count) VALUES (?1, ?2, ?3)")
      .bind(usageDay(day), "static_map", BUDGET_CAPS.static_map - 1)
      .run();

    expect(await chargeBudget(env.DB, "static_map", day)).toBe(true); // the cap-th call
    expect(await chargeBudget(env.DB, "static_map", day)).toBe(false); // one past it
    expect(await chargeBudget(env.DB, "static_map", day)).toBe(false); // and it stays refused
  });

  it("keeps a separate counter per SKU and per UTC day", async () => {
    const day = ownDay();
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    await chargeBudget(env.DB, "autocomplete", day);
    await chargeBudget(env.DB, "autocomplete", next);

    const rows = await env.DB.prepare("SELECT day, count FROM api_usage WHERE sku = 'autocomplete' AND day IN (?1, ?2)")
      .bind(usageDay(day), usageDay(next))
      .all<{ day: string; count: number }>();
    expect(rows.results.map((r) => r.count)).toEqual([1, 1]);
  });

  it("fails CLOSED when the counter cannot be written", async () => {
    // We exist to bound spending we cannot see. If we cannot see it, we stop.
    const broken = {
      prepare: () => {
        throw new Error("D1 is unavailable");
      },
    } as unknown as D1Database;
    expect(await chargeBudget(broken, "autocomplete")).toBe(false);
  });
});

// ----------------------------------------------- the both-or-neither rule --

describe("toEventSummary — the place invariant", () => {
  function row(overrides: Partial<EventRow> = {}): EventRow {
    return {
      id: "evt_1",
      organizer_id: "org_1",
      title: "Game Night",
      game_type: "board",
      starts_at: "2030-01-01T19:00:00Z",
      location: "Central Library, Room 2B",
      capacity: 6,
      rsvp_count: 2,
      room_key: "k",
      status: "scheduled",
      organizer_name: "Metro Meetup Crew",
      description: null,
      place_id: "place-central",
      place_address: "1000 4th Ave, Seattle, WA 98104, USA",
      place_lat: 47.6067,
      place_lng: -122.3325,
      ...overrides,
    };
  }

  it("builds a place when all four columns are present", () => {
    expect(toEventSummary(row()).place).toEqual({
      id: "place-central",
      address: "1000 4th Ave, Seattle, WA 98104, USA",
      lat: 47.6067,
      lng: -122.3325,
    });
  });

  it("reads a half-written row as NO place, never as a pin at 0,0", () => {
    // SQLite cannot add this as a CHECK by ALTER, so the invariant lives in the
    // mapper — and the failure it prevents is a map of the Gulf of Guinea.
    for (const missing of ["place_id", "place_address", "place_lat", "place_lng"] as const) {
      expect(toEventSummary(row({ [missing]: null })).place).toBeNull();
    }
  });

  it("is null for a free-text event, which is an ordinary state", () => {
    expect(
      toEventSummary(row({ place_id: null, place_address: null, place_lat: null, place_lng: null })).place,
    ).toBeNull();
  });

  it("keeps `location` untouched either way — it is what a human reads", () => {
    expect(toEventSummary(row()).location).toBe("Central Library, Room 2B");
    expect(toEventSummary(row({ place_id: null })).location).toBe("Central Library, Room 2B");
  });
});

// ------------------------------------------------------------ deep links --

describe("shared/maps-links", () => {
  const place = { id: "place-central", address: "1000 4th Ave, Seattle, WA 98104, USA", lat: 47.6, lng: -122.3 };

  it("prefers the canonical address and pins the exact place id", () => {
    const url = new URL(mapsSearchUrl({ location: "Central Library, Room 2B", place }));
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("1000 4th Ave, Seattle, WA 98104, USA");
    expect(url.searchParams.get("query_place_id")).toBe("place-central");
  });

  it("falls back to the typed label when there is no verified place", () => {
    const url = new URL(mapsSearchUrl({ location: "Cardboard Castle, 114 Pike St", place: null }));
    expect(url.searchParams.get("query")).toBe("Cardboard Castle, 114 Pike St");
    expect(url.searchParams.has("query_place_id")).toBe(false);
  });

  it("builds directions with no travelmode, so Maps uses whatever the person last used", () => {
    const url = new URL(mapsDirectionsUrl({ location: "x", place }));
    expect(url.pathname).toBe("/maps/dir/");
    expect(url.searchParams.get("destination")).toBe("1000 4th Ave, Seattle, WA 98104, USA");
    expect(url.searchParams.get("destination_place_id")).toBe("place-central");
    expect(url.searchParams.has("travelmode")).toBe(false);
  });

  it("encodes a label that would otherwise break the query string", () => {
    const url = mapsSearchUrl({ location: "Ben & Jerry's, 1st & Pike #3", place: null });
    expect(url).not.toContain("&Jerry");
    expect(new URL(url).searchParams.get("query")).toBe("Ben & Jerry's, 1st & Pike #3");
  });
});
