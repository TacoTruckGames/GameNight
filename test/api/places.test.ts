/**
 * The three places endpoints and the two write paths, through the real Worker.
 *
 * **Nothing here touches the network**, and the suite is arranged in two tiers
 * that prove the two deployments that actually exist:
 *
 * - **No key configured.** This is what every reviewer who clones the
 *   repository gets, and what CI runs. The whole feature must be invisible
 *   rather than broken: `/config` says so, `/suggest` is an empty 200, posting
 *   an event with a place id still works, and — the assertion that matters most
 *   — *nothing reaches the error log*. A configuration absence is not a failure,
 *   and an Errors page that says otherwise is an Errors page an operator learns
 *   to ignore.
 *
 * - **Key configured, upstream unreachable.** `PLACES_ORIGIN` points at
 *   `127.0.0.1:1`, where a connection is refused instantly — a real outage at
 *   zero wall-clock cost. Here the two write paths must *diverge*: creating an
 *   event shrugs and stores free text, an admin re-pointing a venue gets a 503
 *   and nothing is written.
 *
 * `beforeEach` deletes `GOOGLE_MAPS_API_KEY` explicitly. `vitest.config.ts`
 * disables `.env` but not `.dev.vars`, so without this a developer who has a
 * real key locally would run a network-touching suite and not know it.
 */

import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminEvent, ApiErrorBody, EventSummary } from "../../shared/api-types";
import { api, BASE, inDays, seedAdmin, seedEvent, seedUser } from "../helpers";

interface PlacesConfigBody {
  suggest: boolean;
  map: boolean;
}
interface SuggestBody {
  suggestions: { placeId: string; primaryText: string; secondaryText: string }[];
}

/** A dead port: `connect` is refused before a packet is sent, so this is instant. */
const DEAD_ORIGIN = "http://127.0.0.1:1";

type MutableEnv = Record<string, unknown>;

function clearKey(): void {
  delete (env as unknown as MutableEnv)["GOOGLE_MAPS_API_KEY"];
  delete (env as unknown as MutableEnv)["GOOGLE_MAPS_SIGNING_SECRET"];
  delete (env as unknown as MutableEnv)["PLACES_ORIGIN"];
}

/** How many error-log rows exist for the places scopes right now. */
async function placesErrorCount(scope?: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(count), 0) AS n FROM error_log WHERE scope LIKE ?1`,
  )
    .bind(scope ?? "places.%")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function eventPlaceRow(id: string) {
  return env.DB.prepare(
    "SELECT place_id, place_address, place_lat, place_lng, place_resolved_at FROM events WHERE id = ?1",
  )
    .bind(id)
    .first<{
      place_id: string | null;
      place_address: string | null;
      place_lat: number | null;
      place_lng: number | null;
      place_resolved_at: string | null;
    }>();
}

const SEATTLE = {
  id: "place-central-library",
  address: "1000 4th Ave, Seattle, WA 98104, USA",
  lat: 47.6067,
  lng: -122.3325,
};

function newEventBody(extra: Record<string, unknown> = {}) {
  return {
    title: "Verified Venue Night",
    gameType: "board_games",
    startsAt: inDays(5),
    location: "Central Library, Room 2B",
    capacity: 6,
    ...extra,
  };
}

// ============================================================ TIER 2: no key ==

describe("places with no key configured", () => {
  beforeEach(clearKey);

  describe("GET /api/places/config", () => {
    it("reports both capabilities off, to anyone, cacheably", async () => {
      const response = await SELF.fetch(new Request(`${BASE}/api/places/config`));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
      expect(await response.json()).toEqual({ suggest: false, map: false });
    });

    it("is the shape the client branches on", async () => {
      const { body } = await api<PlacesConfigBody>("/api/places/config");
      expect(Object.keys(body).sort()).toEqual(["map", "suggest"]);
    });
  });

  describe("GET /api/places/suggest", () => {
    it("is 401 anonymous and 403 for a player — autocomplete costs money per keystroke", async () => {
      const player = await seedUser({ role: "player" });

      expect((await api<ApiErrorBody>("/api/places/suggest?q=library")).status).toBe(401);

      const forbidden = await api<ApiErrorBody>("/api/places/suggest?q=library", { as: player.id });
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe("FORBIDDEN");
    });

    it("returns an empty 200 for an organizer — a switched-off feature is not an error", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const { status, body } = await api<SuggestBody>("/api/places/suggest?q=library", { as: organizer.id });

      expect(status).toBe(200);
      expect(body).toEqual({ suggestions: [] });
    });

    it("lets an admin through too — the admin edit screen is where a wrong venue gets fixed", async () => {
      const admin = await seedAdmin();
      const { status, body } = await api<SuggestBody>("/api/places/suggest?q=library", { as: admin.id });

      expect(status).toBe(200);
      expect(body.suggestions).toEqual([]);
    });

    it("writes NOTHING to the error log — configuration is not a failure", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const before = await placesErrorCount();

      for (const q of ["library", "central library", "green lake community"]) {
        expect((await api<SuggestBody>(`/api/places/suggest?q=${encodeURIComponent(q)}`, { as: organizer.id })).status)
          .toBe(200);
      }

      // The single most important assertion in this file. An Errors page full of
      // "no key configured" trains an operator to stop reading it, which is the
      // only way an error log can really fail.
      expect(await placesErrorCount()).toBe(before);
    });

    it("short-circuits under three characters without an upstream call", async () => {
      const organizer = await seedUser({ role: "organizer" });
      for (const q of ["", "c", "ce", "  c  "]) {
        const { status, body } = await api<SuggestBody>(`/api/places/suggest?q=${encodeURIComponent(q)}`, {
          as: organizer.id,
        });
        expect(status).toBe(200);
        expect(body.suggestions).toEqual([]);
      }
    });

    it("marks the response private, not public — the route is authenticated", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const response = await SELF.fetch(
        new Request(`${BASE}/api/places/suggest?q=library`, { headers: { "X-User-Id": organizer.id } }),
      );
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    });

    it("rejects an over-long query rather than forwarding it", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const { status } = await api<ApiErrorBody>(`/api/places/suggest?q=${"x".repeat(200)}`, { as: organizer.id });
      expect(status).toBe(400);
    });
  });

  describe("POST /api/events with a placeId", () => {
    it("still creates the event, with place: null", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const { status, body } = await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody({ placeId: "ChIJ-whatever", placeSessionToken: "abc123" }),
      });

      expect(status).toBe(201);
      expect(body.place).toBeNull();
      // The label the organizer typed is untouched: it is the thing a human reads.
      expect(body.location).toBe("Central Library, Room 2B");
    });

    it("leaves all five columns null, not half-written", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const { body } = await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody({ placeId: "ChIJ-whatever" }),
      });

      expect(await eventPlaceRow(body.id)).toEqual({
        place_id: null,
        place_address: null,
        place_lat: null,
        place_lng: null,
        place_resolved_at: null,
      });
    });

    it("does not report it — a missing key is not an outage", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const before = await placesErrorCount("places.details");

      await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody({ placeId: "ChIJ-whatever" }),
      });

      expect(await placesErrorCount("places.details")).toBe(before);
    });

    it("ignores client-sent coordinates entirely — they are not evidence of anything", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const { status, body } = await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody({ placeId: "ChIJ-x", lat: 1.23, lng: 4.56, place: { id: "spoofed" } }),
      });

      expect(status).toBe(201);
      expect(body.place).toBeNull();
    });
  });

  describe("GET /api/events/:id/map", () => {
    it("404s with no-store when the event has no verified venue", async () => {
      const event = await seedEvent();
      const response = await SELF.fetch(new Request(`${BASE}/api/events/${event.id}/map?w=640&h=320&scale=1&v=anything`));

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("404s for an event that does not exist", async () => {
      const response = await SELF.fetch(new Request(`${BASE}/api/events/evt_nope/map?w=640&h=320&scale=1&v=x`));
      expect(response.status).toBe(404);
    });

    it("404s when ?v= does not match the stored place id", async () => {
      // This is the cache buster: an admin re-pointing a venue changes the id,
      // which changes the URL, which invalidates a month of edge cache at once.
      const event = await seedEvent({ place: SEATTLE });
      const stale = await SELF.fetch(new Request(`${BASE}/api/events/${event.id}/map?w=640&h=320&scale=1&v=old-place-id`));
      expect(stale.status).toBe(404);
      expect(stale.headers.get("Cache-Control")).toBe("no-store");
    });

    it.each([
      ["an unlisted size", "w=800&h=600&scale=1"],
      ["a missing size", "scale=1"],
      ["scale 3", "w=640&h=320&scale=3"],
      ["a non-numeric size", "w=abc&h=320&scale=1"],
    ])("400s on %s — an unbounded size is an unbounded number of billed renders", async (_label, query) => {
      const event = await seedEvent({ place: SEATTLE });
      const response = await SELF.fetch(new Request(`${BASE}/api/events/${event.id}/map?${query}&v=${SEATTLE.id}`));
      expect(response.status).toBe(400);
    });

    it.each([
      ["the wide preset", "w=640&h=320"],
      ["the compact preset", "w=320&h=180"],
    ])("accepts %s and 503s with no-store when maps are switched off", async (_label, size) => {
      const event = await seedEvent({ place: SEATTLE });
      const response = await SELF.fetch(new Request(`${BASE}/api/events/${event.id}/map?${size}&scale=2&v=${SEATTLE.id}`));

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(((await response.json()) as ApiErrorBody).error.code).toBe("PLACE_UNAVAILABLE");
    });

    it("answers from caches.default before it ever touches D1", async () => {
      // The whole cost argument rests on this: the event id below does not
      // exist, so a HIT is the only way this can be a 200.
      const url = `${BASE}/api/events/evt_not_in_d1/map?w=640&h=320&scale=1&v=cached`;
      await caches.default.put(
        url,
        new Response("fake-png-bytes", {
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
        }),
      );

      const response = await SELF.fetch(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Map-Cache")).toBe("HIT");
      expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("fake-png-bytes");
    });
  });

  describe("the rest of the API is unaffected", () => {
    it("every event on the board carries an explicit place field", async () => {
      const free = await seedEvent({ startsAt: inDays(1) });
      const verified = await seedEvent({ startsAt: inDays(1), place: SEATTLE });

      const { body } = await api<EventSummary[]>("/api/events");
      expect(body.find((e) => e.id === free.id)?.place).toBeNull();
      expect(body.find((e) => e.id === verified.id)?.place).toEqual(SEATTLE);
    });
  });
});

// ================================= TIER 3: key configured, upstream is dead ==

describe("places with a key but an unreachable upstream", () => {
  beforeEach(() => {
    (env as unknown as MutableEnv)["GOOGLE_MAPS_API_KEY"] = "test-key-not-a-real-one";
    (env as unknown as MutableEnv)["PLACES_ORIGIN"] = DEAD_ORIGIN;
  });
  afterEach(clearKey);

  it("advertises both capabilities as on — the flag is about the key, not about Google's health", async () => {
    const { body } = await api<PlacesConfigBody>("/api/places/config");
    expect(body).toEqual({ suggest: true, map: true });
  });

  it("still returns an empty 200 from suggest, and DOES report the outage", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const before = await placesErrorCount("places.suggest");

    const { status, body } = await api<SuggestBody>("/api/places/suggest?q=central+library", { as: organizer.id });

    expect(status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
    // Unlike the no-key case: this one is a real failure and an operator wants it.
    expect(await placesErrorCount("places.suggest")).toBeGreaterThan(before);
  });

  describe("POST /api/events — degrades, never blocks", () => {
    it("creates the event with place: null and logs one places.details failure", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const before = await placesErrorCount("places.details");

      const { status, body } = await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody({ placeId: "ChIJ-unreachable", placeSessionToken: "sess-1" }),
      });

      // A third-party outage must not block the product's core action.
      expect(status).toBe(201);
      expect(body.place).toBeNull();
      expect(body.location).toBe("Central Library, Room 2B");
      expect(await placesErrorCount("places.details")).toBeGreaterThan(before);
    });

    it("does not call out at all when no placeId was sent", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const before = await placesErrorCount("places.details");

      const { status } = await api<EventSummary>("/api/events", {
        method: "POST",
        as: organizer.id,
        body: newEventBody(),
      });

      expect(status).toBe(201);
      expect(await placesErrorCount("places.details")).toBe(before);
    });
  });

  describe("PATCH /api/admin/events/:id — fails loudly, on purpose", () => {
    it("503s PLACE_UNAVAILABLE and writes nothing", async () => {
      const admin = await seedAdmin();
      const event = await seedEvent({ place: SEATTLE, title: "Before" });

      const { status, body } = await api<ApiErrorBody>(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        as: admin.id,
        body: { placeId: "ChIJ-unreachable", title: "After" },
      });

      expect(status).toBe(503);
      expect(body.error.code).toBe("PLACE_UNAVAILABLE");

      // Nothing written — not the place, and not the title that shared the patch.
      const row = await eventPlaceRow(event.id);
      expect(row?.place_id).toBe(SEATTLE.id);
      expect(row?.place_lat).toBe(SEATTLE.lat);
      const after = await api<AdminEvent>(`/api/admin/events/${event.id}`, { as: admin.id });
      expect(after.body.title).toBe("Before");
    });

    it("telling an operator 'saved' when nothing changed would be a lie — so it does not", async () => {
      const admin = await seedAdmin();
      const event = await seedEvent({ place: SEATTLE });

      const { status } = await api(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        as: admin.id,
        body: { placeId: "ChIJ-unreachable" },
      });
      expect(status).not.toBe(200);
    });

    it("still unlinks a venue without a network call — clearing always works", async () => {
      const admin = await seedAdmin();
      const event = await seedEvent({ place: SEATTLE });

      const { status, body } = await api<AdminEvent>(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        as: admin.id,
        body: { placeId: null },
      });

      expect(status).toBe(200);
      expect(body.place).toBeNull();
      expect(await eventPlaceRow(event.id)).toEqual({
        place_id: null,
        place_address: null,
        place_lat: null,
        place_lng: null,
        place_resolved_at: null,
      });
    });

    it("leaves the place alone when the patch does not mention it", async () => {
      const admin = await seedAdmin();
      const event = await seedEvent({ place: SEATTLE });

      const { status, body } = await api<AdminEvent>(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        as: admin.id,
        body: { title: "Renamed" },
      });

      expect(status).toBe(200);
      expect(body.place).toEqual(SEATTLE);
    });
  });

  describe("the daily budget", () => {
    const today = new Date().toISOString().slice(0, 10);

    afterEach(async () => {
      await env.DB.prepare("DELETE FROM api_usage WHERE day = ?1").bind(today).run();
    });

    it("stops before the upstream call once the cap is spent", async () => {
      const organizer = await seedUser({ role: "organizer" });
      // Park the counter one short of the cap's refusal point.
      await env.DB.prepare(
        `INSERT INTO api_usage (day, sku, count) VALUES (?1, 'autocomplete', 99999)
         ON CONFLICT(day, sku) DO UPDATE SET count = 99999`,
      )
        .bind(today)
        .run();

      const before = await placesErrorCount("places.suggest");
      const { status, body } = await api<SuggestBody>("/api/places/suggest?q=central+library", { as: organizer.id });

      expect(status).toBe(200);
      expect(body).toEqual({ suggestions: [] });
      // No error row is the proof that no call was attempted: the same request
      // one test above DID produce one, because it reached the dead port.
      expect(await placesErrorCount("places.suggest")).toBe(before);
    });

    it("stops the map route too, with the same 503 an outage produces", async () => {
      const event = await seedEvent({ place: SEATTLE });
      await env.DB.prepare(
        `INSERT INTO api_usage (day, sku, count) VALUES (?1, 'static_map', 99999)
         ON CONFLICT(day, sku) DO UPDATE SET count = 99999`,
      )
        .bind(today)
        .run();

      const before = await placesErrorCount("places.map");
      const response = await SELF.fetch(
        new Request(`${BASE}/api/events/${event.id}/map?w=640&h=320&scale=1&v=${SEATTLE.id}`),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await placesErrorCount("places.map")).toBe(before);
    });
  });
});
