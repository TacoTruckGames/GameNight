/**
 * The calendar's date arithmetic, tested away from React.
 *
 * Every case uses fixed dates — nothing here reads the clock, so the suite means
 * the same thing in September 2026 as it will in 2030. The zone-sensitive cases
 * pass an explicit `timeZone` because the Workers test runtime is UTC and would
 * otherwise never exercise the boundary the browser hits every evening.
 */

import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  dayKey,
  eventCountLabel,
  formatDayHeading,
  formatDayLong,
  formatMonthLabel,
  groupByDay,
  monthOf,
  parseDayKey,
  sameMonth,
  shiftMonth,
  weekdayLabels,
} from "../../src/lib/calendar";

const at = (iso: string) => new Date(iso);

describe("dayKey", () => {
  it("keeps a UTC evening on its own UTC day", () => {
    expect(dayKey(at("2026-09-18T19:00:00Z"), "UTC")).toBe("2026-09-18");
  });

  it("reads back across UTC midnight for a westward zone", () => {
    const instant = at("2026-09-19T03:00:00Z");
    expect(dayKey(instant, "America/Los_Angeles")).toBe("2026-09-18");
    expect(dayKey(instant, "UTC")).toBe("2026-09-19");
  });

  it("reads forward across UTC midnight for an eastward zone", () => {
    expect(dayKey(at("2026-09-18T23:30:00Z"), "Pacific/Auckland")).toBe("2026-09-19");
  });

  it("zero-pads the month and day", () => {
    expect(dayKey(at("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
  });

  it("returns null for an unparseable date instead of throwing", () => {
    expect(dayKey(new Date("nope"))).toBeNull();
  });

  // Documents the runtime assumption, not a promise: this test process is UTC,
  // so omitting the zone matches "UTC" here. The browser's default is the
  // reader's own zone, which is the whole reason the parameter exists.
  it("defaults to the runtime zone, which is UTC in this test runtime", () => {
    const instant = at("2026-09-19T03:00:00Z");
    expect(dayKey(instant)).toBe(dayKey(instant, "UTC"));
  });
});

describe("groupByDay", () => {
  it("groups in first-seen key order and preserves input order within a group", () => {
    const events = [
      { id: "a", startsAt: "2026-09-18T18:00:00Z" },
      { id: "b", startsAt: "2026-09-18T20:00:00Z" },
      { id: "c", startsAt: "2026-09-19T10:00:00Z" },
      { id: "d", startsAt: "2026-09-18T22:00:00Z" },
    ];
    const groups = groupByDay(events, "UTC");
    expect(groups.map((group) => group.key)).toEqual(["2026-09-18", "2026-09-19"]);
    expect(groups.map((group) => group.events.length)).toEqual([3, 1]);
    expect(groups[0]?.events.map((event) => event.id)).toEqual(["a", "b", "d"]);
    expect(groups[1]?.events.map((event) => event.id)).toEqual(["c"]);
  });

  it("puts one Los Angeles evening in one group, though it spans two UTC days", () => {
    const events = [{ startsAt: "2026-09-18T23:00:00Z" }, { startsAt: "2026-09-19T03:00:00Z" }];
    const la = groupByDay(events, "America/Los_Angeles");
    expect(la).toHaveLength(1);
    expect(la[0]?.key).toBe("2026-09-18");
    expect(la[0]?.events).toHaveLength(2);
    expect(groupByDay(events, "UTC")).toHaveLength(2);
  });

  it("returns [] for no events and skips one that will not parse", () => {
    expect(groupByDay([], "UTC")).toEqual([]);
    const groups = groupByDay(
      [
        { id: "a", startsAt: "2026-09-18T18:00:00Z" },
        { id: "bad", startsAt: "whenever" },
        { id: "b", startsAt: "2026-09-19T18:00:00Z" },
      ],
      "UTC",
    );
    expect(groups.map((group) => group.key)).toEqual(["2026-09-18", "2026-09-19"]);
    expect(groups.flatMap((group) => group.events.map((event) => event.id))).toEqual(["a", "b"]);
  });
});

describe("buildMonthGrid", () => {
  const september = buildMonthGrid({ year: 2026, month: 9 }, null, 1);
  const flat = september.flat();

  it("lays September 2026 out as 5 full weeks from the Monday before the 1st", () => {
    expect(september).toHaveLength(5);
    for (const row of september) expect(row).toHaveLength(7);
    expect(september[0]?.[0]).toMatchObject({ key: "2026-08-31", inMonth: false });
    expect(september[0]?.[1]).toMatchObject({ key: "2026-09-01", day: 1, inMonth: true });
  });

  it("ends the month on the 30th and pads into October", () => {
    const inMonth = flat.filter((cell) => cell.inMonth);
    expect(inMonth.at(-1)).toMatchObject({ key: "2026-09-30", day: 30 });
    expect(flat.slice(-4).map((cell) => cell.key)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(flat.slice(-4).every((cell) => !cell.inMonth)).toBe(true);
  });

  it("gives a month starting on Sunday six leading pads on a Monday start and none on a Sunday start", () => {
    const monday = buildMonthGrid({ year: 2026, month: 11 }, null, 1);
    expect(monday).toHaveLength(6);
    expect(monday.flat().findIndex((cell) => cell.inMonth)).toBe(6);

    const sunday = buildMonthGrid({ year: 2026, month: 11 }, null, 0);
    expect(sunday).toHaveLength(5);
    expect(sunday.flat().findIndex((cell) => cell.inMonth)).toBe(0);
  });

  it.each([
    ["leap", 2028, 29],
    ["common", 2027, 28],
  ])("counts %s February as %i days", (_label, year, days) => {
    const grid = buildMonthGrid({ year, month: 2 }, null, 1);
    expect(grid.flat().filter((cell) => cell.inMonth)).toHaveLength(days);
  });

  it("fits February 2027 in exactly four rows (the 1st is a Monday)", () => {
    expect(buildMonthGrid({ year: 2027, month: 2 }, null, 1)).toHaveLength(4);
  });

  it("marks exactly one cell as today, and none for another month or null", () => {
    const marked = buildMonthGrid({ year: 2026, month: 9 }, "2026-09-15", 1)
      .flat()
      .filter((cell) => cell.isToday);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.key).toBe("2026-09-15");

    const elsewhere = buildMonthGrid({ year: 2026, month: 9 }, "2026-12-01", 1);
    expect(elsewhere.flat().filter((cell) => cell.isToday)).toHaveLength(0);
    expect(flat.filter((cell) => cell.isToday)).toHaveLength(0);
  });

  it("emits keys that round-trip through parseDayKey and increase strictly", () => {
    for (const cell of flat) {
      const { year, month, day } = parseDayKey(cell.key);
      expect(day).toBe(cell.day);
      expect(new Date(Date.UTC(year, month - 1, day)).getUTCDate()).toBe(cell.day);
    }
    const keys = flat.map((cell) => cell.key);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("shiftMonth, monthOf and sameMonth", () => {
  it.each([
    [{ year: 2026, month: 12 }, 1, { year: 2027, month: 1 }],
    [{ year: 2026, month: 1 }, -1, { year: 2025, month: 12 }],
    [{ year: 2026, month: 3 }, 13, { year: 2027, month: 4 }],
    [{ year: 2026, month: 3 }, -15, { year: 2024, month: 12 }],
    [{ year: 2026, month: 9 }, 0, { year: 2026, month: 9 }],
  ])("shifts %o by %i", (from, delta, expected) => {
    expect(shiftMonth(from, delta)).toEqual(expected);
  });

  it("reads the year and month off a day key", () => {
    expect(monthOf("2026-09-18")).toEqual({ year: 2026, month: 9 });
    expect(monthOf("2026-01-05")).toEqual({ year: 2026, month: 1 });
  });

  it("compares two cursors", () => {
    expect(sameMonth({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe(true);
    expect(sameMonth({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBe(false);
    expect(sameMonth({ year: 2026, month: 9 }, { year: 2025, month: 9 })).toBe(false);
  });
});

describe("labels", () => {
  it("names the month, the day and the long day", () => {
    expect(formatMonthLabel({ year: 2026, month: 9 })).toBe("September 2026");
    expect(formatDayHeading("2026-09-18")).toBe("Fri, Sep 18");
    expect(formatDayLong("2026-09-18")).toBe("Friday, September 18");
  });

  it("rotates the weekday headers for the week start", () => {
    const monday = weekdayLabels(1);
    expect(monday).toHaveLength(7);
    expect(monday[0]).toBe("Mon");
    expect(monday[6]).toBe("Sun");
    expect(weekdayLabels(0)[0]).toBe("Sun");
    expect(weekdayLabels()).toEqual(monday);
  });

  it.each([
    [1, "1 event"],
    [3, "3 events"],
    [0, "0 events"],
  ])("labels %i as %s", (n, expected) => {
    expect(eventCountLabel(n)).toBe(expected);
  });
});
