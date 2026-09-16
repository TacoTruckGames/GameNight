/**
 * A month of days, each one a button.
 *
 * Deliberately not `role="grid"`: a grid promises arrow-key roving focus, and a
 * promise we don't keep is worse for a screen-reader user than never making it.
 * So this is an ordinary list of labelled buttons — each one's accessible name
 * carries weekday, date and count ("Friday, September 18, 2 events"), which is
 * why the weekday header row is `aria-hidden`: it would otherwise be read seven
 * times over with nothing to attach to. Days with no events are `disabled`, so
 * Tab stops only on days you can actually open. Both month buttons always work:
 * the page asks the server for whichever month is on screen, past ones included,
 * so there is nothing behind Prev to protect the reader from.
 */

import { useId } from "react";
import {
  buildMonthGrid,
  eventCountLabel,
  formatDayLong,
  formatMonthLabel,
  shiftMonth,
  weekdayLabels,
  WEEK_STARTS_ON,
  type DayKey,
  type YearMonth,
} from "../lib/calendar";

export function MonthCalendar({
  month,
  todayKey,
  counts,
  selectedDay,
  onSelectDay,
  onMonthChange,
}: {
  month: YearMonth;
  todayKey: DayKey;
  counts: ReadonlyMap<DayKey, number>;
  selectedDay: DayKey | null;
  onSelectDay: (key: DayKey) => void;
  onMonthChange: (next: YearMonth) => void;
}) {
  const monthId = useId();
  return (
    <div className="cal" role="group" aria-labelledby={monthId}>
      <div className="cal__nav">
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          aria-label="Previous month"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          ‹ Prev
        </button>
        <h2 className="cal__month" id={monthId} aria-live="polite">
          {formatMonthLabel(month)}
        </h2>
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          aria-label="Next month"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
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
        {buildMonthGrid(month, todayKey, WEEK_STARTS_ON)
          .flat()
          .map((cell) => {
            if (!cell.inMonth) return <li className="cal__pad" aria-hidden="true" key={cell.key} />;
            const count = counts.get(cell.key) ?? 0;
            return (
              <li key={cell.key}>
                <button
                  type="button"
                  className={cell.isToday ? "cal__day cal__day--today" : "cal__day"}
                  aria-label={`${formatDayLong(cell.key)}, ${eventCountLabel(count)}`}
                  aria-pressed={cell.key === selectedDay}
                  disabled={count === 0}
                  onClick={() => onSelectDay(cell.key)}
                >
                  <span className="cal__num">{cell.day}</span>
                  {count > 0 ? <span className="cal__count tnum">{count}</span> : null}
                </button>
              </li>
            );
          })}
      </ol>
    </div>
  );
}
