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
  formatWeekLabel,
  groupByDay,
  monthOf,
  parseDayKey,
  sameMonth,
  shiftDays,
  shiftMonth,
  startOfWeek,
  weekDays,
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
    expect(flat.slice(-4).map((cell) => cell.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
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

  it("marks every day before today as past, and never today itself", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9 }, "2026-09-15", 1).flat();
    const byKey = (key: string) => grid.find((cell) => cell.key === key);

    expect(byKey("2026-09-14")?.isPast).toBe(true);
    // The boundary: a game tonight has not happened yet.
    expect(byKey("2026-09-15")?.isPast).toBe(false);
    expect(byKey("2026-09-16")?.isPast).toBe(false);

    // Leading cells belong to August and are all behind us; trailing ones are not.
    expect(grid.filter((cell) => !cell.inMonth && cell.key < "2026-09-15").every((c) => c.isPast)).toBe(true);
    expect(grid.every((cell) => cell.isPast === cell.key < "2026-09-15")).toBe(true);
  });

  it("treats the whole month as past or future when today is elsewhere", () => {
    const allPast = buildMonthGrid({ year: 2026, month: 9 }, "2026-12-01", 1).flat();
    expect(allPast.every((cell) => cell.isPast)).toBe(true);

    const allFuture = buildMonthGrid({ year: 2026, month: 9 }, "2026-01-01", 1).flat();
    expect(allFuture.some((cell) => cell.isPast)).toBe(false);
  });

  it("has no past days at all when there is no today", () => {
    // `null` means "no now to be before" — greying the whole grid would be wrong.
    expect(flat.some((cell) => cell.isPast)).toBe(false);
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

describe("shiftDays", () => {
  it.each([
    ["over a month end", "2026-01-31", 1, "2026-02-01"],
    ["back over a month end", "2026-03-01", -1, "2026-02-28"],
    ["over a year end", "2026-12-31", 1, "2027-01-01"],
    ["back over a year end", "2027-01-01", -1, "2026-12-31"],
    ["onto a leap day", "2028-02-28", 1, "2028-02-29"],
    ["off a leap day", "2028-02-29", 1, "2028-03-01"],
    ["past a February that has no 29th", "2027-02-28", 1, "2027-03-01"],
    ["a week forward", "2026-09-14", 7, "2026-09-21"],
    ["a week back", "2026-09-14", -7, "2026-09-07"],
    ["nowhere", "2026-09-14", 0, "2026-09-14"],
    ["into a single-digit month and day, zero-padded", "2026-08-31", 1, "2026-09-01"],
    ["a whole non-leap year", "2026-09-14", 365, "2027-09-14"],
  ])("shifts %s", (_label, key, delta, expected) => {
    expect(shiftDays(key, delta)).toBe(expected);
  });

  it("is reversible", () => {
    for (const delta of [1, -1, 7, -7, 30, 365]) {
      expect(shiftDays(shiftDays("2026-02-28", delta), -delta)).toBe("2026-02-28");
    }
  });
});

describe("startOfWeek", () => {
  // 2026-09-14 is a Monday, 09-16 a Wednesday and 09-20 the Sunday that closes
  // that week — so all three answer with the same Monday.
  it.each([
    ["the Monday itself", "2026-09-14"],
    ["a Wednesday", "2026-09-16"],
    ["the closing Sunday", "2026-09-20"],
  ])("takes %s back to 2026-09-14 on a Monday start", (_label, key) => {
    expect(startOfWeek(key, 1)).toBe("2026-09-14");
  });

  it.each([
    ["across a month end", "2026-10-02", "2026-09-28"],
    ["from a Sunday, which belongs to the week before", "2026-11-01", "2026-10-26"],
    ["across a year end", "2027-01-01", "2026-12-28"],
  ])("walks back %s", (_label, key, expected) => {
    expect(startOfWeek(key, 1)).toBe(expected);
  });

  it.each([
    ["a Monday now opens the week before", "2026-09-14", "2026-09-13"],
    ["a Sunday is its own week start", "2026-11-01", "2026-11-01"],
    ["across a month end", "2026-09-01", "2026-08-30"],
    ["across a year end", "2027-01-01", "2026-12-27"],
  ])("on a Sunday start, %s", (_label, key, expected) => {
    expect(startOfWeek(key, 0)).toBe(expected);
  });

  it("defaults to the board's Monday start", () => {
    expect(startOfWeek("2026-09-16")).toBe(startOfWeek("2026-09-16", 1));
    expect(startOfWeek("2026-09-16")).toBe("2026-09-14");
  });

  it("is idempotent — a week start is already the start of its week", () => {
    for (const weekStartsOn of [0, 1] as const) {
      for (const key of ["2026-09-16", "2026-11-01", "2027-01-01", "2028-02-29"]) {
        const start = startOfWeek(key, weekStartsOn);
        expect(startOfWeek(start, weekStartsOn)).toBe(start);
      }
    }
  });
});

describe("weekDays", () => {
  it("returns exactly seven consecutive, strictly increasing days", () => {
    const days = weekDays("2026-09-14");
    expect(days).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(days).toHaveLength(7);
    expect(days).toEqual([...days].sort());
    expect(new Set(days).size).toBe(7);
  });

  it.each([
    ["a month end", "2026-09-28", "2026-10-04"],
    ["a year end", "2026-12-28", "2027-01-03"],
  ])("crosses %s", (_label, start, lastDay) => {
    const days = weekDays(start);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe(lastDay);
  });

  it("gives seven days that all map back to the start they came from", () => {
    for (const [weekStartsOn, start] of [
      [1, "2026-12-28"],
      [0, "2026-12-27"],
    ] as const) {
      for (const key of weekDays(start)) {
        expect(startOfWeek(key, weekStartsOn)).toBe(start);
      }
    }
  });
});

describe("formatWeekLabel", () => {
  it.each([
    ["a week inside one month", "2026-09-14", "Sep 14 – 20"],
    ["a Sunday-start week inside one month", "2026-09-13", "Sep 13 – 19"],
    ["a week straddling two months", "2026-09-28", "Sep 28 – Oct 4"],
    ["a week straddling two years", "2026-12-28", "Dec 28, 2026 – Jan 3, 2027"],
    ["December, still inside its year", "2026-12-21", "Dec 21 – 27"],
  ])("labels %s", (_label, start, expected) => {
    expect(formatWeekLabel(start)).toBe(expected);
  });

  it("separates the ends with a plain-spaced en dash", () => {
    // `Intl`'s `formatRange` would pad the dash with U+2009 thin spaces here,
    // which is invisible in a diff and a surprise in every assertion that meets
    // it. This label is composed by hand precisely so it cannot happen.
    for (const start of ["2026-09-14", "2026-09-28", "2026-12-28"]) {
      const label = formatWeekLabel(start);
      expect(label).toContain(" – ");
      // No NBSP, thin or narrow no-break space: the label is copied into chats.
      expect(label).not.toMatch(/[\u00A0\u2009\u202F]/);
    }
  });
});
