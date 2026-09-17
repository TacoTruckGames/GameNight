/**
 * The shared zod schemas, tested away from HTTP.
 *
 * These are the same objects the client imports, so what passes here is exactly
 * what the browser will pre-validate — but the server is still the only
 * enforcement point, which `test/api/events.test.ts` covers.
 */

import { describe, expect, it } from "vitest";

import { createEventSchema, createUserSchema, dateWindowQuerySchema, eventsQuerySchema } from "../../shared/schemas";

const NOW = new Date("2026-09-15T12:00:00Z");
const schema = createEventSchema(NOW);

function valid(overrides: Record<string, unknown> = {}) {
  return {
    title: "Friday Night Draft",
    gameType: "card",
    startsAt: "2026-09-20T19:00:00Z",
    location: "Cardboard Castle",
    capacity: 8,
    ...overrides,
  };
}

/** The first issue reported for a given field, or `undefined`. */
function issueFor(input: Record<string, unknown>, path: string): string | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join(".") === path)?.message;
}

describe("createEventSchema", () => {
  it("accepts a valid payload and trims the strings", () => {
    const result = schema.safeParse(valid({ title: "  Draft  ", location: "  Hall  " }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Draft");
      expect(result.data.location).toBe("Hall");
      expect(result.data.capacity).toBe(8);
    }
  });

  describe("capacity", () => {
    // The whole point of `z.int()` over a coercion: nothing is quietly repaired.
    it.each([
      ["zero", 0],
      ["negative", -1],
      ["fractional", 1.5],
      ["over the maximum", 501],
      ["a numeric string", "8"],
      ["missing", undefined],
      ["null", null],
    ])("rejects %s", (_label, capacity) => {
      expect(issueFor(valid({ capacity }), "capacity")).toBeDefined();
    });

    it.each([1, 2, 500])("accepts %i", (capacity) => {
      expect(issueFor(valid({ capacity }), "capacity")).toBeUndefined();
    });
  });

  describe("startsAt", () => {
    it("rejects a time in the past", () => {
      expect(issueFor(valid({ startsAt: "2026-09-14T19:00:00Z" }), "startsAt")).toBe(
        "Start time must be in the future",
      );
    });

    it("rejects the current instant (must be strictly in the future)", () => {
      expect(issueFor(valid({ startsAt: "2026-09-15T12:00:00Z" }), "startsAt")).toBe(
        "Start time must be in the future",
      );
    });

    it.each(["", "tomorrow", "2026-09-20", "2026-13-01T19:00:00Z"])("rejects %o as a date-time", (startsAt) => {
      expect(issueFor(valid({ startsAt }), "startsAt")).toBeDefined();
    });

    it("reports exactly one issue for an unparseable value", () => {
      const result = schema.safeParse(valid({ startsAt: "nonsense" }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.filter((issue) => issue.path[0] === "startsAt")).toHaveLength(1);
      }
    });

    it("accepts a non-UTC offset", () => {
      expect(issueFor(valid({ startsAt: "2026-09-20T19:00:00-07:00" }), "startsAt")).toBeUndefined();
    });
  });

  describe("title and location", () => {
    it("rejects a blank title", () => {
      expect(issueFor(valid({ title: "   " }), "title")).toBe("Title is required");
    });

    it("rejects a title over 80 characters", () => {
      expect(issueFor(valid({ title: "x".repeat(81) }), "title")).toBeDefined();
    });

    it("rejects a blank location", () => {
      expect(issueFor(valid({ location: "" }), "location")).toBe("Location is required");
    });

    it("rejects a location over 120 characters", () => {
      expect(issueFor(valid({ location: "x".repeat(121) }), "location")).toBeDefined();
    });
  });

  it("rejects an unknown gameType", () => {
    expect(issueFor(valid({ gameType: "chess" }), "gameType")).toBeDefined();
  });

  it("reports every bad field at once, so the form can highlight all of them", () => {
    const result = schema.safeParse({
      title: "",
      gameType: "chess",
      startsAt: "2020-01-01T00:00:00Z",
      location: "",
      capacity: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = new Set(result.error.issues.map((issue) => issue.path.join(".")));
      expect(paths).toEqual(new Set(["title", "gameType", "startsAt", "location", "capacity"]));
    }
  });
});

describe("createUserSchema", () => {
  it("trims the name", () => {
    const result = createUserSchema.safeParse({ name: "  Alice  " });
    expect(result.success && result.data.name).toBe("Alice");
  });

  it.each([
    ["blank", "   "],
    ["missing", undefined],
    ["too long", "x".repeat(41)],
  ])("rejects a %s name", (_label, name) => {
    expect(createUserSchema.safeParse({ name }).success).toBe(false);
  });

  it("accepts exactly 40 characters", () => {
    expect(createUserSchema.safeParse({ name: "x".repeat(40) }).success).toBe(true);
  });

  it("defaults the role to player and accepts either role", () => {
    const result = createUserSchema.safeParse({ name: "Alice" });
    expect(result.success && result.data.role).toBe("player");
    expect(createUserSchema.safeParse({ name: "Alice", role: "organizer" }).success).toBe(true);
  });

  it.each([
    ["unknown", "admin"],
    ["blank", ""],
    ["wrong case", "Player"],
  ])("rejects a %s role", (_label, role) => {
    expect(createUserSchema.safeParse({ name: "Alice", role }).success).toBe(false);
  });
});

describe("eventsQuerySchema", () => {
  it("normalises absent, blank and whitespace filters to undefined", () => {
    expect(eventsQuerySchema.parse({})).toEqual({ q: undefined, gameType: undefined, sort: "date" });
    expect(eventsQuerySchema.parse({ q: "", gameType: "" })).toEqual({
      q: undefined,
      gameType: undefined,
      sort: "date",
    });
    expect(eventsQuerySchema.parse({ q: "   " })).toEqual({ q: undefined, gameType: undefined, sort: "date" });
  });

  it("trims a search term and keeps a valid game type", () => {
    expect(eventsQuerySchema.parse({ q: "  draft  ", gameType: "card" })).toEqual({
      q: "draft",
      gameType: "card",
      sort: "date",
    });
  });

  it("defaults a blank or absent sort to date and keeps a valid one", () => {
    expect(eventsQuerySchema.parse({ sort: "" }).sort).toBe("date");
    expect(eventsQuerySchema.parse({ sort: "popular" }).sort).toBe("popular");
  });

  it("rejects an unknown game type, an unknown sort and an over-long search", () => {
    expect(eventsQuerySchema.safeParse({ gameType: "chess" }).success).toBe(false);
    expect(eventsQuerySchema.safeParse({ sort: "alphabetical" }).success).toBe(false);
    expect(eventsQuerySchema.safeParse({ q: "x".repeat(81) }).success).toBe(false);
  });

  // The window rule lives in one place and this schema is one of its consumers;
  // if the two ever drift apart, this is the test that says so.
  it("rejects half a window with the same rule the /me lists use", () => {
    const result = eventsQuerySchema.safeParse({ from: "2026-09-14T00:00:00Z", sort: "popular" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["to"]);
  });
});

describe("dateWindowQuerySchema", () => {
  const FROM = "2026-09-14T00:00:00Z";
  const TO = "2026-09-21T00:00:00Z";

  it("treats an absent window as no window", () => {
    expect(dateWindowQuerySchema.parse({})).toEqual({ from: undefined, to: undefined });
  });

  it("treats a blank window as no window — `?from=&to=` is a browser, not a caller", () => {
    expect(dateWindowQuerySchema.parse({ from: "", to: "" })).toEqual({ from: undefined, to: undefined });
  });

  it("passes a whole window through unchanged, offset and all", () => {
    expect(dateWindowQuerySchema.parse({ from: FROM, to: TO })).toEqual({ from: FROM, to: TO });
    // The offset form is the one a browser actually sends: the week strip turns
    // a local Monday midnight into an instant, and re-spelling it is the
    // worker's job, not the schema's.
    const offset = { from: "2026-09-14T00:00:00-07:00", to: "2026-09-21T00:00:00-07:00" };
    expect(dateWindowQuerySchema.parse(offset)).toEqual(offset);
  });

  it("rejects half a window, reporting the missing half", () => {
    const loneFrom = dateWindowQuerySchema.safeParse({ from: FROM });
    expect(loneFrom.success).toBe(false);
    if (!loneFrom.success) expect(loneFrom.error.issues[0]?.path).toEqual(["to"]);

    const loneTo = dateWindowQuerySchema.safeParse({ to: TO });
    expect(loneTo.success).toBe(false);
    if (!loneTo.success) expect(loneTo.error.issues[0]?.path).toEqual(["from"]);
  });

  it("reports a malformed end as one issue on that end", () => {
    const result = dateWindowQuerySchema.safeParse({ from: "last-tuesday", to: TO });
    expect(result.success).toBe(false);
    if (!result.success) {
      // One issue, not two: the field failed, so the both-or-neither rule never
      // ran and cannot pile a second complaint on top of the real one.
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toEqual(["from"]);
    }
  });
});
