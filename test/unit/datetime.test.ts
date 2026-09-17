/**
 * The "has it happened yet" rule, tested away from React.
 *
 * Every case pins `now` explicitly — nothing here reads the clock, so the suite
 * means the same thing in September 2026 as it will in 2030. The rest of
 * `datetime.ts` is `Intl` formatting, which is the runtime's job to get right
 * and would only be tested against itself.
 */

import { describe, expect, it } from "vitest";

import { isPastEvent, upcomingGroups } from "../../src/lib/datetime";
import type { DayGroup } from "../../src/lib/calendar";

const NOW = new Date("2026-09-16T19:00:00Z");
const at = (iso: string) => ({ id: iso, startsAt: iso });
const group = (key: string, ...isos: string[]): DayGroup<{ id: string; startsAt: string }> => ({
  key,
  events: isos.map(at),
});
const keys = (groups: DayGroup<{ id: string; startsAt: string }>[]) =>
  groups.map((g) => `${g.key}:${g.events.map((e) => e.startsAt).join(",")}`);

describe("isPastEvent", () => {
  it("is past once the start time has arrived", () => {
    expect(isPastEvent("2026-09-16T18:59:59Z", NOW)).toBe(true);
    expect(isPastEvent("2026-09-16T19:00:01Z", NOW)).toBe(false);
  });

  it("treats the exact start instant as past — the table has begun", () => {
    expect(isPastEvent("2026-09-16T19:00:00Z", NOW)).toBe(true);
  });

  it("treats an unparseable date as not past, so a live event is never greyed by a bad string", () => {
    expect(isPastEvent("tuesday-ish", NOW)).toBe(false);
  });
});

describe("upcomingGroups", () => {
  it("drops the events that have already started and keeps the rest in order", () => {
    const out = upcomingGroups(
      [group("2026-09-16", "2026-09-16T17:00:00Z", "2026-09-16T20:00:00Z", "2026-09-16T23:00:00Z")],
      NOW,
    );
    expect(keys(out)).toEqual(["2026-09-16:2026-09-16T20:00:00Z,2026-09-16T23:00:00Z"]);
  });

  it("drops a day that is left with nothing, rather than showing an empty heading", () => {
    const out = upcomingGroups(
      [group("2026-09-15", "2026-09-15T18:00:00Z"), group("2026-09-17", "2026-09-17T18:00:00Z")],
      NOW,
    );
    expect(keys(out)).toEqual(["2026-09-17:2026-09-17T18:00:00Z"]);
  });

  it("comes back empty when the whole span is over — a past week has nothing upcoming in it", () => {
    const out = upcomingGroups(
      [group("2026-09-07", "2026-09-07T18:00:00Z"), group("2026-09-09", "2026-09-09T18:00:00Z")],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("leaves the caller's groups alone — the day pane still opens past days", () => {
    const groups = [group("2026-09-15", "2026-09-15T18:00:00Z", "2026-09-15T21:00:00Z")];
    upcomingGroups(groups, NOW);
    expect(groups[0]!.events).toHaveLength(2);
  });

  it("defaults `now` to the clock", () => {
    expect(upcomingGroups([group("1999-01-01", "1999-01-01T18:00:00Z")])).toEqual([]);
  });
});
