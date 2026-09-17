import { describe, expect, it } from "vitest";

import type { ApiErrorBody, AttendeesResponse, EventDetail, EventSummary } from "../../shared/api-types";
import { env } from "cloudflare:test";

import { DESCRIPTION_MAX } from "../../shared/schemas";
import { api, cancelEvent, inDays, putRsvp, seedAdmin, seedEvent, seedUser, seedUsers } from "../helpers";

/** The list is shared across tests, so always look for *our* event in it. */
function find(list: EventSummary[], id: string): EventSummary | undefined {
  return list.find((event) => event.id === id);
}

describe("GET /api/events", () => {
  it("lists upcoming events and hides past ones", async () => {
    const upcoming = await seedEvent({ startsAt: inDays(2) });
    const past = await seedEvent({ startsAt: inDays(-3) });

    const { status, body } = await api<EventSummary[]>("/api/events");

    expect(status).toBe(200);
    expect(find(body, upcoming.id)).toBeDefined();
    expect(find(body, past.id)).toBeUndefined();
    // No window is the upcoming board, whatever else is asked for: the other
    // filters must not quietly open the list up to the past.
    const filtered = await api<EventSummary[]>(`/api/events?q=${encodeURIComponent(past.title)}&sort=popular`);
    expect(find(filtered.body, past.id)).toBeUndefined();
  });

  it("orders by start time, soonest first", async () => {
    const later = await seedEvent({ startsAt: inDays(40) });
    const sooner = await seedEvent({ startsAt: inDays(39) });

    const { body } = await api<EventSummary[]>("/api/events");
    const ids = body.map((event) => event.id);

    expect(ids.indexOf(sooner.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));
    // …and the whole list is sorted, not just our two.
    const startTimes = body.map((event) => event.startsAt);
    expect(startTimes).toEqual([...startTimes].sort());
  });

  it("derives attendeeCount, seatsLeft and isFull from rsvp_count", async () => {
    const players = await seedUsers(3);
    const partial = await seedEvent({ capacity: 5, rsvpPlayerIds: players.map((p) => p.id) });
    const full = await seedEvent({ capacity: 3, rsvpPlayerIds: players.map((p) => p.id) });
    const empty = await seedEvent({ capacity: 2 });

    const { body } = await api<EventSummary[]>("/api/events");

    expect(find(body, partial.id)).toMatchObject({ attendeeCount: 3, capacity: 5, seatsLeft: 2, isFull: false });
    expect(find(body, full.id)).toMatchObject({ attendeeCount: 3, capacity: 3, seatsLeft: 0, isFull: true });
    expect(find(body, empty.id)).toMatchObject({ attendeeCount: 0, seatsLeft: 2, isFull: false });
  });

  it("includes the organizer's name", async () => {
    const organizer = await seedUser({ role: "organizer", name: "Cardboard Castle Games" });
    const event = await seedEvent({ organizer });

    const { body } = await api<EventSummary[]>("/api/events");
    expect(find(body, event.id)?.organizerName).toBe("Cardboard Castle Games");
  });

  it("filters by gameType", async () => {
    const warhammer = await seedEvent({ gameType: "miniatures" });
    const dnd = await seedEvent({ gameType: "rpg" });

    const { body } = await api<EventSummary[]>("/api/events?gameType=miniatures");

    expect(find(body, warhammer.id)).toBeDefined();
    expect(find(body, dnd.id)).toBeUndefined();
    expect(body.every((event) => event.gameType === "miniatures")).toBe(true);
  });

  it("400s on an unknown gameType", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/events?gameType=chess");
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.[0]?.path).toBe("gameType");
  });

  it("searches the title and the location", async () => {
    const token = crypto.randomUUID().slice(0, 8);
    const byTitle = await seedEvent({ title: `Zephyr ${token} Night`, location: "Somewhere Else" });
    const byLocation = await seedEvent({ title: "Unrelated", location: `Basement of ${token}` });
    const neither = await seedEvent({ title: "Unrelated", location: "Somewhere Else" });

    const { body } = await api<EventSummary[]>(`/api/events?q=${token}`);

    expect(find(body, byTitle.id)).toBeDefined();
    expect(find(body, byLocation.id)).toBeDefined();
    expect(find(body, neither.id)).toBeUndefined();
  });

  it("treats % and _ in a search as literals, not wildcards", async () => {
    const token = crypto.randomUUID().slice(0, 8);
    const literal = await seedEvent({ title: `100% ${token} off` });
    const decoy = await seedEvent({ title: `100 percent ${token} off` });

    // If `%` were passed through unescaped, `%100%%` would match the decoy too.
    const { body } = await api<EventSummary[]>(`/api/events?q=${encodeURIComponent(`100% ${token}`)}`);

    expect(find(body, literal.id)).toBeDefined();
    expect(find(body, decoy.id)).toBeUndefined();

    // Same story for `_`, SQL's single-character wildcard.
    const underscored = await seedEvent({ title: `a_b ${token}` });
    const notUnderscored = await seedEvent({ title: `axb ${token}` });
    const underscore = await api<EventSummary[]>(`/api/events?q=${encodeURIComponent(`a_b ${token}`)}`);

    expect(find(underscore.body, underscored.id)).toBeDefined();
    expect(find(underscore.body, notUnderscored.id)).toBeUndefined();
  });

  it("ignores blank filters", async () => {
    const event = await seedEvent();
    const { status, body } = await api<EventSummary[]>("/api/events?q=&gameType=&sort=");
    expect(status).toBe(200);
    expect(find(body, event.id)).toBeDefined();
  });

  it("400s on an unknown sort", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/events?sort=alphabetical");
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.[0]?.path).toBe("sort");
  });

  describe("?from=&to= (the date window)", () => {
    it("returns events inside the window, past ones included", async () => {
      const longAgo = await seedEvent({ startsAt: inDays(-40) });
      const past = await seedEvent({ startsAt: inDays(-20) });
      const upcoming = await seedEvent({ startsAt: inDays(20) });

      const { status, body } = await api<EventSummary[]>(`/api/events?from=${inDays(-30)}&to=${inDays(30)}`);

      expect(status).toBe(200);
      // The whole point: a day behind today still has its events.
      expect(find(body, past.id)).toBeDefined();
      expect(find(body, upcoming.id)).toBeDefined();
      expect(find(body, longAgo.id)).toBeUndefined();
    });

    it("excludes events outside the window, and is half-open at both ends", async () => {
      const before = await seedEvent({ startsAt: inDays(-10) });
      const after = await seedEvent({ startsAt: inDays(10) });
      // Exactly on each boundary: `from` is inclusive, `to` is exclusive, so a
      // month's last instant belongs to that month and the next month's first
      // instant does not. Each boundary is computed once and reused — `inDays`
      // reads the clock at second precision, and sampling it twice across a
      // tick would put the seeded row one second off the window it queries.
      const from = inDays(-5);
      const to = inDays(5);
      const onFrom = await seedEvent({ startsAt: from });
      const onTo = await seedEvent({ startsAt: to });

      const { body } = await api<EventSummary[]>(`/api/events?from=${from}&to=${to}`);

      expect(find(body, onFrom.id)).toBeDefined();
      expect(find(body, onTo.id)).toBeUndefined();
      expect(find(body, before.id)).toBeUndefined();
      expect(find(body, after.id)).toBeUndefined();
    });

    it("still hides cancelled events inside the window", async () => {
      const cancelled = await seedEvent({ startsAt: inDays(-15) });
      const kept = await seedEvent({ startsAt: inDays(-15) });
      await cancelEvent(cancelled.id);

      const { body } = await api<EventSummary[]>(`/api/events?from=${inDays(-16)}&to=${inDays(-14)}`);

      expect(find(body, kept.id)).toBeDefined();
      expect(find(body, cancelled.id)).toBeUndefined();
    });

    it("combines with gameType and q", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const wanted = await seedEvent({ title: `${token} wanted`, gameType: "miniatures", startsAt: inDays(-8) });
      const wrongType = await seedEvent({ title: `${token} wrong type`, gameType: "rpg", startsAt: inDays(-8) });
      const wrongTerm = await seedEvent({ title: "unrelated past", gameType: "miniatures", startsAt: inDays(-8) });
      const outside = await seedEvent({ title: `${token} outside`, gameType: "miniatures", startsAt: inDays(-80) });

      const { status, body } = await api<EventSummary[]>(
        `/api/events?from=${inDays(-9)}&to=${inDays(-7)}&gameType=miniatures&q=${token}`,
      );

      expect(status).toBe(200);
      expect(find(body, wanted.id)).toBeDefined();
      expect(find(body, wrongType.id)).toBeUndefined();
      expect(find(body, wrongTerm.id)).toBeUndefined();
      expect(find(body, outside.id)).toBeUndefined();
    });

    it("400s on half a window — `from` without `to`", async () => {
      const { status, body } = await api<ApiErrorBody>(`/api/events?from=${inDays(-5)}`);
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_FAILED");
      // Reported against the half that is missing, which is the one to add.
      expect(body.error.details?.[0]?.path).toBe("to");
    });

    it("400s on half a window — `to` without `from`", async () => {
      const { status, body } = await api<ApiErrorBody>(`/api/events?to=${inDays(5)}`);
      expect(status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.details?.[0]?.path).toBe("from");
    });

    it("400s on a window end that is not a date-time", async () => {
      const { status, body } = await api<ApiErrorBody>(`/api/events?from=last-tuesday&to=${inDays(5)}`);
      expect(status).toBe(400);
      expect(body.error.details?.[0]?.path).toBe("from");
    });

    it("treats a blank window as no window at all", async () => {
      const past = await seedEvent({ startsAt: inDays(-2) });
      const upcoming = await seedEvent({ startsAt: inDays(2) });

      const { status, body } = await api<EventSummary[]>("/api/events?from=&to=");

      expect(status).toBe(200);
      expect(find(body, upcoming.id)).toBeDefined();
      expect(find(body, past.id)).toBeUndefined();
    });
  });

  describe("?sort=popular", () => {
    /**
     * Three tables that disagree about which is "first" under each ordering, all
     * tagged with one search token so the shared database's other events cannot
     * wander into the assertion.
     *
     * `cold` has *more* attendees than `hot` and fewer of its seats taken — it
     * is there to prove the ranking is by ratio, not by head count.
     */
    async function seedTrio() {
      const token = crypto.randomUUID().slice(0, 8);
      const players = await seedUsers(4);
      const ids = players.map((player) => player.id);
      const full = await seedEvent({ title: `${token} full`, capacity: 2, rsvpPlayerIds: ids.slice(0, 2), startsAt: inDays(7) });
      const cold = await seedEvent({ title: `${token} cold`, capacity: 8, rsvpPlayerIds: ids, startsAt: inDays(8) });
      const hot = await seedEvent({ title: `${token} hot`, capacity: 4, rsvpPlayerIds: ids.slice(0, 3), startsAt: inDays(9) });
      return { token, full, cold, hot };
    }

    it("ranks by how full a table is, not by attendee count", async () => {
      const { token, full, cold, hot } = await seedTrio();

      const { status, body } = await api<EventSummary[]>(`/api/events?q=${token}&sort=popular`);

      expect(status).toBe(200);
      // Fullest joinable table first; the full one sinks even though it starts soonest.
      expect(body.map((event) => event.id)).toEqual([hot.id, cold.id, full.id]);
      expect(find(body, cold.id)!.attendeeCount).toBeGreaterThan(find(body, hot.id)!.attendeeCount);
    });

    it("leaves ?sort=date (the default) ordering by start time", async () => {
      const { token, full, cold, hot } = await seedTrio();

      const byDate = await api<EventSummary[]>(`/api/events?q=${token}&sort=date`);
      const byDefault = await api<EventSummary[]>(`/api/events?q=${token}`);

      expect(byDate.body.map((event) => event.id)).toEqual([full.id, cold.id, hot.id]);
      expect(byDefault.body.map((event) => event.id)).toEqual(byDate.body.map((event) => event.id));
    });

    it("breaks ties on start time, so equally full tables read soonest-first", async () => {
      const token = crypto.randomUUID().slice(0, 8);
      const players = await seedUsers(2);
      const later = await seedEvent({ title: `${token} later`, capacity: 4, rsvpPlayerIds: [players[0]!.id], startsAt: inDays(21) });
      const sooner = await seedEvent({ title: `${token} sooner`, capacity: 4, rsvpPlayerIds: [players[1]!.id], startsAt: inDays(20) });

      const { body } = await api<EventSummary[]>(`/api/events?q=${token}&sort=popular`);

      expect(body.map((event) => event.id)).toEqual([sooner.id, later.id]);
    });
  });

  it("does not leak a per-caller field (the list is edge-cacheable by design)", async () => {
    const player = await seedUser();
    const event = await seedEvent({ rsvpPlayerIds: [player.id] });

    const { body } = await api<EventSummary[]>("/api/events", { as: player.id });
    expect(find(body, event.id)).not.toHaveProperty("myRsvp");
  });
});

describe("GET /api/events/:id", () => {
  it("404s for an unknown id", async () => {
    const { status, body } = await api<ApiErrorBody>(`/api/events/evt_${crypto.randomUUID()}`);
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns myRsvp = null when nobody is signed in", async () => {
    const event = await seedEvent();
    const { status, body } = await api<EventDetail>(`/api/events/${event.id}`);
    expect(status).toBe(200);
    expect(body.myRsvp).toBeNull();
    expect(body.id).toBe(event.id);
  });

  it("returns myRsvp true/false for a player", async () => {
    const attending = await seedUser();
    const other = await seedUser();
    const event = await seedEvent({ rsvpPlayerIds: [attending.id] });

    expect((await api<EventDetail>(`/api/events/${event.id}`, { as: attending.id })).body.myRsvp).toBe(true);
    expect((await api<EventDetail>(`/api/events/${event.id}`, { as: other.id })).body.myRsvp).toBe(false);
  });

  it("returns a past event by id (only the list hides them)", async () => {
    const event = await seedEvent({ startsAt: inDays(-1) });
    const { status } = await api<EventDetail>(`/api/events/${event.id}`);
    expect(status).toBe(200);
  });
});

describe("POST /api/events", () => {
  function payload(overrides: Record<string, unknown> = {}) {
    return {
      title: "New Event",
      gameType: "card",
      startsAt: inDays(5),
      location: "Somewhere",
      capacity: 6,
      ...overrides,
    };
  }

  it("401s without an identity", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/events", { method: "POST", body: payload() });
    expect(status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("403s for a player", async () => {
    const player = await seedUser();
    const { status, body } = await api<ApiErrorBody>("/api/events", {
      method: "POST",
      as: player.id,
      body: payload(),
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("creates an event with rsvp_count 0 and returns it", async () => {
    const organizer = await seedUser({ role: "organizer", name: "Metro Meetup Crew" });
    const { status, body } = await api<EventSummary>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: payload({ title: "  Padded Title  ", capacity: 7 }),
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      title: "Padded Title",
      gameType: "card",
      capacity: 7,
      attendeeCount: 0,
      seatsLeft: 7,
      isFull: false,
      organizerName: "Metro Meetup Crew",
    });
    expect(body.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // It is really in the board.
    const list = await api<EventSummary[]>("/api/events");
    expect(find(list.body, body.id)).toBeDefined();
  });

  it("normalises a non-UTC start time to UTC seconds", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const { body } = await api<EventSummary>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: payload({ startsAt: "2099-03-01T12:30:00-08:00" }),
    });
    expect(body.startsAt).toBe("2099-03-01T20:30:00Z");
  });

  it.each([
    ["capacity 0", { capacity: 0 }, "capacity"],
    ["capacity 501", { capacity: 501 }, "capacity"],
    ["capacity as a string", { capacity: "8" }, "capacity"],
    ["a fractional capacity", { capacity: 1.5 }, "capacity"],
    ["a past start time", { startsAt: inDays(-1) }, "startsAt"],
    ["an unparseable start time", { startsAt: "not-a-date" }, "startsAt"],
    ["a blank title", { title: "   " }, "title"],
    ["a blank location", { location: "" }, "location"],
    ["an unknown gameType", { gameType: "chess" }, "gameType"],
  ])("400s on %s with a details path", async (_label, overrides, path) => {
    const organizer = await seedUser({ role: "organizer" });
    const { status, body } = await api<ApiErrorBody>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: payload(overrides),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.map((detail) => detail.path)).toContain(path);
  });

  it("reports every invalid field in one response", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const { status, body } = await api<ApiErrorBody>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: payload({ capacity: 0, startsAt: inDays(-2) }),
    });

    expect(status).toBe(400);
    expect(body.error.details?.map((detail) => detail.path).sort()).toEqual(["capacity", "startsAt"]);
  });
});

describe("GET /api/events/:id/attendees", () => {
  it("returns the event and its attendees in RSVP order to the owning organizer", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const [first, second, third] = await seedUsers(3);
    const event = await seedEvent({
      organizer,
      capacity: 5,
      rsvpPlayerIds: [first!.id, second!.id, third!.id],
    });

    const { status, body } = await api<AttendeesResponse>(`/api/events/${event.id}/attendees`, { as: organizer.id });

    expect(status).toBe(200);
    expect(body.event.id).toBe(event.id);
    expect(body.attendees.map((attendee) => attendee.playerId)).toEqual([first!.id, second!.id, third!.id]);
    expect(body.attendees[0]).toMatchObject({ name: first!.name });
    expect(body.attendees[0]?.rsvpAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("403s for a different organizer", async () => {
    const owner = await seedUser({ role: "organizer" });
    const stranger = await seedUser({ role: "organizer" });
    const event = await seedEvent({ organizer: owner });

    const { status, body } = await api<ApiErrorBody>(`/api/events/${event.id}/attendees`, { as: stranger.id });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("403s for a player, even one who is attending", async () => {
    const player = await seedUser();
    const event = await seedEvent({ rsvpPlayerIds: [player.id] });

    const { status } = await api<ApiErrorBody>(`/api/events/${event.id}/attendees`, { as: player.id });
    expect(status).toBe(403);
  });

  it("401s when signed out", async () => {
    const event = await seedEvent();
    const { status } = await api<ApiErrorBody>(`/api/events/${event.id}/attendees`);
    expect(status).toBe(401);
  });

  it("404s for an unknown event", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const { status } = await api<ApiErrorBody>(`/api/events/evt_${crypto.randomUUID()}/attendees`, {
      as: organizer.id,
    });
    expect(status).toBe(404);
  });
});

describe("GET /api/me/hosted", () => {
  it("returns only the caller's own upcoming events", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const mine = await seedEvent({ organizer, startsAt: inDays(4) });
    const minePast = await seedEvent({ organizer, startsAt: inDays(-4) });
    const theirs = await seedEvent();

    const { status, body } = await api<EventSummary[]>("/api/me/hosted", { as: organizer.id });

    expect(status).toBe(200);
    expect(body.map((event) => event.id)).toEqual([mine.id]);
    expect(find(body, minePast.id)).toBeUndefined();
    expect(find(body, theirs.id)).toBeUndefined();
  });

  it("403s for a player", async () => {
    const player = await seedUser();
    const { status } = await api<ApiErrorBody>("/api/me/hosted", { as: player.id });
    expect(status).toBe(403);
  });

  /**
   * The same window as `GET /api/events`, for the organizer's week agenda.
   *
   * Every boundary is a `const` computed once and reused for both the seed and
   * the query: `inDays` reads the clock, so calling it twice would put a row a
   * tick outside the window it was meant to sit on.
   */
  describe("?from=&to= (the date window)", () => {
    it("returns the organizer's own past and upcoming events inside the window", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const from = inDays(-30);
      const to = inDays(30);
      const past = await seedEvent({ organizer, startsAt: inDays(-10) });
      const upcoming = await seedEvent({ organizer, startsAt: inDays(10) });
      const outside = await seedEvent({ organizer, startsAt: inDays(60) });
      const theirs = await seedEvent({ startsAt: inDays(-10) });

      const { status, body } = await api<EventSummary[]>(`/api/me/hosted?from=${from}&to=${to}`, {
        as: organizer.id,
      });

      expect(status).toBe(200);
      // Soonest first, and the night behind today is back — that is the point.
      expect(body.map((event) => event.id)).toEqual([past.id, upcoming.id]);
      expect(find(body, outside.id)).toBeUndefined();
      // Still only the caller's own: a window widens the dates, not the owner.
      expect(find(body, theirs.id)).toBeUndefined();
    });

    it("is half-open: `from` inclusive, `to` exclusive", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const from = inDays(-5);
      const to = inDays(5);
      const onFrom = await seedEvent({ organizer, startsAt: from });
      const inside = await seedEvent({ organizer, startsAt: inDays(1) });
      const onTo = await seedEvent({ organizer, startsAt: to });

      const { body } = await api<EventSummary[]>(`/api/me/hosted?from=${from}&to=${to}`, { as: organizer.id });

      expect(body.map((event) => event.id)).toEqual([onFrom.id, inside.id]);
      expect(find(body, onTo.id)).toBeUndefined();
    });

    it("keeps the organizer's own cancelled event inside a window", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const from = inDays(-20);
      const to = inDays(-1);
      const cancelled = await seedEvent({ organizer, startsAt: inDays(-10) });
      await cancelEvent(cancelled.id);

      const { body } = await api<EventSummary[]>(`/api/me/hosted?from=${from}&to=${to}`, { as: organizer.id });

      // Unlike the public board, which hides them: this is the organizer's own
      // history, and a night they called off still happened to them.
      expect(body.map((event) => event.id)).toEqual([cancelled.id]);
    });

    it("400s on half a window, naming the missing half", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const from = inDays(-5);
      const to = inDays(5);

      const loneFrom = await api<ApiErrorBody>(`/api/me/hosted?from=${from}`, { as: organizer.id });
      expect(loneFrom.status).toBe(400);
      expect(loneFrom.body.error.code).toBe("VALIDATION_FAILED");
      expect(loneFrom.body.error.details?.[0]?.path).toBe("to");

      const loneTo = await api<ApiErrorBody>(`/api/me/hosted?to=${to}`, { as: organizer.id });
      expect(loneTo.status).toBe(400);
      expect(loneTo.body.error.details?.[0]?.path).toBe("from");
    });

    it("treats a blank window as no window at all", async () => {
      const organizer = await seedUser({ role: "organizer" });
      const past = await seedEvent({ organizer, startsAt: inDays(-3) });
      const upcoming = await seedEvent({ organizer, startsAt: inDays(3) });

      const { status, body } = await api<EventSummary[]>("/api/me/hosted?from=&to=", { as: organizer.id });

      expect(status).toBe(200);
      expect(body.map((event) => event.id)).toEqual([upcoming.id]);
      expect(find(body, past.id)).toBeUndefined();
    });

    it("403s a player before it looks at the window", async () => {
      const player = await seedUser();
      const from = inDays(-5);
      const to = inDays(5);

      expect((await api(`/api/me/hosted?from=${from}&to=${to}`, { as: player.id })).status).toBe(403);
      // Half a window and the wrong role: the role is the honest answer, so the
      // auth check runs first and a 400 never leaks the shape of a list you
      // cannot read.
      expect((await api(`/api/me/hosted?from=${from}`, { as: player.id })).status).toBe(403);
    });
  });
});

/**
 * Appended with the verified-venues feature.
 *
 * The point of the whole design is that `location` did not change: it is still
 * the required free-text label, and the place data sits *alongside* it. Which
 * means search has two haystacks now, and the interesting case is the one where
 * they disagree.
 */
describe("GET /api/events?q= — searching the verified address", () => {
  const PIKE = {
    id: "place-pike-hall",
    address: "1501 Pike Pl, Seattle, WA 98101, USA",
    lat: 47.6094,
    lng: -122.3417,
  };

  it("finds an event by its canonical address when the typed label says nothing of the sort", async () => {
    // "back room" is exactly the kind of label an organizer types, and exactly
    // the kind nobody searches for. The address is what a player knows.
    const event = await seedEvent({ location: "The back room", place: PIKE, startsAt: inDays(5) });

    const { status, body } = await api<EventSummary[]>("/api/events?q=Pike%20Pl");

    expect(status).toBe(200);
    expect(find(body, event.id)).toBeDefined();
    expect(find(body, event.id)?.location).toBe("The back room"); // label untouched
  });

  it("still matches the typed label, and still matches the title", async () => {
    const event = await seedEvent({ title: "Unique Draft Night", location: "Somewhere Specific", startsAt: inDays(5) });

    expect(find((await api<EventSummary[]>("/api/events?q=Somewhere%20Specific")).body, event.id)).toBeDefined();
    expect(find((await api<EventSummary[]>("/api/events?q=Unique%20Draft")).body, event.id)).toBeDefined();
  });

  it("does not match an event whose address merely exists", async () => {
    const event = await seedEvent({ location: "The back room", place: PIKE, startsAt: inDays(5) });
    const { body } = await api<EventSummary[]>("/api/events?q=Nowhere%20Boulevard%20Xyzzy");
    expect(find(body, event.id)).toBeUndefined();
  });

  it("keeps escaping LIKE wildcards in the new clause too", async () => {
    // `%` is a literal, here as everywhere else: a search for it must not turn
    // into a full-table match.
    const event = await seedEvent({ location: "The back room", place: PIKE, startsAt: inDays(5) });
    const { body } = await api<EventSummary[]>("/api/events?q=%25");
    expect(find(body, event.id)).toBeUndefined();
  });

  it("carries the place through to the detail endpoint", async () => {
    const event = await seedEvent({ location: "The back room", place: PIKE, startsAt: inDays(5) });
    const { body } = await api<EventDetail>(`/api/events/${event.id}`);
    expect(body.place).toEqual(PIKE);
  });
});

// ------------------------------------------------------------- description --

describe("event descriptions", () => {
  /** Posts a valid event as a fresh organizer, with whatever `description` is given. */
  async function post(overrides: Record<string, unknown>) {
    const organizer = await seedUser({ role: "organizer" });
    return api<EventSummary>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: {
        title: "Described Night",
        gameType: "card",
        startsAt: inDays(5),
        location: "Somewhere",
        capacity: 6,
        ...overrides,
      },
    });
  }

  async function storedDescription(id: string): Promise<string | null | undefined> {
    const row = await env.DB.prepare("SELECT description FROM events WHERE id = ?1")
      .bind(id)
      .first<{ description: string | null }>();
    return row?.description;
  }

  it("returns the description on the detail route", async () => {
    const prose = "Casual Commander, decks provided for beginners. Ring the bell after 7.";
    const { status, body } = await post({ description: `  ${prose}  ` });

    expect(status).toBe(201);
    const detail = await api<EventDetail>(`/api/events/${body.id}`);
    expect(detail.body.description).toBe(prose); // trimmed, like title and location
  });

  it("is null when the organizer wrote none", async () => {
    const { body } = await post({});
    const detail = await api<EventDetail>(`/api/events/${body.id}`);
    expect(detail.body.description).toBeNull();
  });

  it("stores a blank textarea as NULL, never as an empty string", async () => {
    // The difference matters: `''` would render as an empty paragraph and read
    // as a deliberate blank, when nothing was ever typed.
    const { body } = await post({ description: "   " });

    expect(await storedDescription(body.id)).toBeNull();
    expect((await api<EventDetail>(`/api/events/${body.id}`)).body.description).toBeNull();
  });

  it(`400s past ${DESCRIPTION_MAX} characters, on the description field`, async () => {
    const { status, body } = await post({ description: "x".repeat(DESCRIPTION_MAX + 1) });
    const error = body as unknown as ApiErrorBody;

    expect(status).toBe(400);
    expect(error.error.code).toBe("VALIDATION_FAILED");
    expect(error.error.details?.[0]?.path).toBe("description");

    // …and exactly at the cap is fine.
    expect((await post({ description: "x".repeat(DESCRIPTION_MAX) })).status).toBe(201);
  });

  it("never appears on the list, not even as null", async () => {
    // A deliberate payload decision, pinned: the board is 50 rows and this is
    // its one unbounded field. The detail page is where someone decides.
    const { body } = await post({ description: "Prose that the board has no room for." });

    const list = await api<EventSummary[]>("/api/events");
    const card = find(list.body, body.id);
    expect(card).toBeDefined();
    expect(card && "description" in card).toBe(false);
  });
});

describe("PATCH /api/events/:id", () => {
  const patch = (id: string, body: unknown, as?: string) =>
    api<EventDetail>(`/api/events/${id}`, { method: "PATCH", body, as });
  /** The same call when the interesting half of the answer is the error. */
  const patchFails = (id: string, body: unknown, as?: string) =>
    api<ApiErrorBody>(`/api/events/${id}`, { method: "PATCH", body, as });

  it("lets the owning organizer change their own event", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent({ organizer, title: "Old Title", capacity: 6 });
    const startsAt = inDays(9);

    const { status, body } = await patch(
      event.id,
      { title: "New Title", gameType: "rpg", startsAt, location: "Back Room", capacity: 10 },
      organizer.id,
    );

    expect(status).toBe(200);
    expect(body.title).toBe("New Title");
    expect(body.gameType).toBe("rpg");
    expect(body.location).toBe("Back Room");
    expect(body.capacity).toBe(10);
    expect(body.seatsLeft).toBe(10);
    expect(body.organizerId).toBe(organizer.id);
    // Stored in the one format, whatever offset arrived.
    expect(body.startsAt).toMatch(/Z$/);
    expect(Date.parse(body.startsAt)).toBe(Date.parse(startsAt));

    // …and the change is in the row, not only in the response.
    const reread = await api<EventDetail>(`/api/events/${event.id}`);
    expect(reread.body.title).toBe("New Title");
    expect(reread.body.capacity).toBe(10);
  });

  it("leaves absent fields alone and clears a description with an explicit null", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent({ organizer, title: "Keep Me" });

    await patch(event.id, { description: "Bring dice." }, organizer.id);
    expect((await api<EventDetail>(`/api/events/${event.id}`)).body.description).toBe("Bring dice.");

    // One field sent, and only that field moves.
    const { body } = await patch(event.id, { capacity: 12 }, organizer.id);
    expect(body.title).toBe("Keep Me");
    expect(body.description).toBe("Bring dice.");

    const cleared = await patch(event.id, { description: null }, organizer.id);
    expect(cleared.body.description).toBeNull();
  });

  it("raising capacity rotates the room key, so a hydrated room cannot keep saying full", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const players = await seedUsers(2);
    const event = await seedEvent({ organizer, capacity: 2 });

    // Fill it through the DO, so the room is hydrated and caching capacity 2.
    for (const player of players) expect((await putRsvp(event.id, player.id)).status).toBe(201);
    const third = await seedUser();
    expect((await putRsvp(event.id, third.id)).status).toBe(409);

    const { body } = await patch(event.id, { capacity: 4 }, organizer.id);
    expect(body.capacity).toBe(4);
    expect(body.isFull).toBe(false);

    // The seat the old room would have refused.
    expect((await putRsvp(event.id, third.id)).status).toBe(201);
  });

  it("refuses a capacity below the people already coming, as a field error", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const players = await seedUsers(3);
    const event = await seedEvent({ organizer, capacity: 8, rsvpPlayerIds: players.map((p) => p.id) });

    const { status, body } = await patchFails(event.id, { capacity: 2 }, organizer.id);

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.[0]?.path).toBe("capacity");
    expect(body.error.details?.[0]?.message).toContain("3");
    // Nothing was written.
    expect((await api<EventDetail>(`/api/events/${event.id}`)).body.capacity).toBe(8);
  });

  it("refuses a start time in the past and an empty patch", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent({ organizer });

    const past = await patchFails(event.id, { startsAt: inDays(-1) }, organizer.id);
    expect(past.status).toBe(400);
    expect(past.body.error.details?.[0]?.path).toBe("startsAt");

    const empty = await patchFails(event.id, {}, organizer.id);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("is the owning organizer's alone", async () => {
    const owner = await seedUser({ role: "organizer" });
    const other = await seedUser({ role: "organizer" });
    const player = await seedUser();
    const admin = await seedAdmin();
    const event = await seedEvent({ organizer: owner, title: "Mine" });

    expect((await patch(event.id, { title: "Yours" })).status).toBe(401);
    expect((await patch(event.id, { title: "Yours" }, player.id)).status).toBe(403);
    // An admin is not an organizer on this route — they have their own.
    expect((await patch(event.id, { title: "Yours" }, admin.id)).status).toBe(403);

    const stranger = await patchFails(event.id, { title: "Yours" }, other.id);
    expect(stranger.status).toBe(403);
    expect(stranger.body.error.code).toBe("FORBIDDEN");

    expect((await api<EventDetail>(`/api/events/${event.id}`)).body.title).toBe("Mine");
  });

  it("404s an event that does not exist, and 409s one that was cancelled", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const event = await seedEvent({ organizer });

    expect((await patch("evt_missing", { title: "x" }, organizer.id)).status).toBe(404);

    await cancelEvent(event.id);
    const { status, body } = await patchFails(event.id, { title: "x" }, organizer.id);
    expect(status).toBe(409);
    expect(body.error.code).toBe("EVENT_CANCELLED");
  });

  it("checks who you are before it checks what you sent", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const player = await seedUser();
    const event = await seedEvent({ organizer });

    // A patch that would fail validation, from someone not allowed to send it:
    // the 403 has to win, or the route leaks that the event exists.
    expect((await patch(event.id, { capacity: -5 }, player.id)).status).toBe(403);
  });
});
