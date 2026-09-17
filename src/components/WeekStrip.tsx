/**
 * A week of days, each one a button — the month grid's row, on its own.
 *
 * Every accessibility decision here is `MonthCalendar`'s, made once and not
 * restated: not `role="grid"`, each button's name carrying weekday/date/count,
 * the weekday header `aria-hidden`, empty days `disabled`, both nav buttons
 * always live. Read that file for the reasoning; this one only differs in how
 * many cells it draws.
 *
 * Which is why it adds no CSS: a strip *is* one row of the existing seven-column
 * `.cal__grid`, so the same `.cal__day` cell, the same today ring, the same past
 * treatment. The only new thing is the label, and `.cal__month` already styles a
 * date range as well as it styles a month name. There are no padding cells — a
 * week always has exactly seven days and they all belong to it — so `.cal__pad`
 * makes no appearance.
 *
 * `formatWeekLabel` reads "Sep 14 – 20", which spoken alone in a live region is
 * "Sep 14 20" — a pair of numbers, not a week. The visually hidden "Week of "
 * in front costs nothing on screen and makes the announcement a sentence.
 */

import { useId } from "react";
import {
  eventCountLabel,
  formatDayLong,
  formatWeekLabel,
  parseDayKey,
  shiftDays,
  weekDays,
  weekdayLabels,
  WEEK_STARTS_ON,
  type DayKey,
} from "../lib/calendar";

export function WeekStrip({
  weekStart,
  todayKey,
  counts,
  selectedDay,
  onSelectDay,
  onWeekChange,
}: {
  weekStart: DayKey;
  todayKey: DayKey;
  counts: ReadonlyMap<DayKey, number>;
  selectedDay: DayKey | null;
  onSelectDay: (key: DayKey) => void;
  onWeekChange: (nextStart: DayKey) => void;
}) {
  const labelId = useId();
  return (
    <div className="cal" role="group" aria-labelledby={labelId}>
      <div className="cal__nav">
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          aria-label="Previous week"
          onClick={() => onWeekChange(shiftDays(weekStart, -7))}
        >
          ‹ Prev
        </button>
        <h2 className="cal__month" id={labelId} aria-live="polite">
          <span className="visually-hidden">Week of </span>
          {formatWeekLabel(weekStart)}
        </h2>
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          aria-label="Next week"
          onClick={() => onWeekChange(shiftDays(weekStart, 7))}
        >
          Next ›
        </button>
      </div>
      <div className="cal__weekdays" aria-hidden="true">
        {weekdayLabels(WEEK_STARTS_ON).map((label) => (
          <span className="cal__weekday" key={label}>
            {label}
          </span>
        ))}
      </div>
      <ol className="cal__grid">
        {weekDays(weekStart).map((key) => {
          const count = counts.get(key) ?? 0;
          // Same reading as the board's: a finished day is still worth opening
          // — checking what you went to is a real reason to page back — but it
          // is not something you can act on, so it looks the way a past card
          // does. Keys are zero-padded, so `<` is calendar order.
          const classes = ["cal__day"];
          if (key === todayKey) classes.push("cal__day--today");
          if (key < todayKey) classes.push("cal__day--past");
          return (
            <li key={key}>
              <button
                type="button"
                className={classes.join(" ")}
                aria-label={`${formatDayLong(key)}, ${eventCountLabel(count)}`}
                aria-pressed={key === selectedDay}
                disabled={count === 0}
                onClick={() => onSelectDay(key)}
              >
                <span className="cal__num">{parseDayKey(key).day}</span>
                {count > 0 ? <span className="cal__count tnum">{count}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
