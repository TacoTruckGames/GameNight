/**
 * Fourteen days, as fourteen divs.
 *
 * No chart library for two bars of two weeks: a bar is a `<div>` whose width is
 * a percentage of the busiest day, and the exact number sits next to it in
 * `tabular-nums`, so the shape and the value are both readable — and the whole
 * thing still works with CSS off, as a labelled list.
 *
 * Marked `role="img"` with a summary label, because fourteen rows of "Sep 3, 0"
 * is not what a screen-reader user wants read out.
 */

import type { DayCount } from "../../shared/api-types";
import { formatUtcDay } from "../lib/datetime";

export function DayBars({ title, days }: { title: string; days: DayCount[] }) {
  const max = days.reduce((best, day) => Math.max(best, day.count), 0);
  const total = days.reduce((sum, day) => sum + day.count, 0);

  return (
    <section className="card">
      <div className="card__row">
        <h2 className="card__title">{title}</h2>
        <span className="text-sm muted tnum">{total} in 14 days</span>
      </div>
      <ul className="admin-bars" role="img" aria-label={`${title}: ${total} over the last 14 days, by day (UTC)`}>
        {days.map((day) => (
          <li className="admin-bars__row" key={day.day}>
            <span className="admin-bars__day">{formatUtcDay(day.day)}</span>
            <span className="admin-bars__track">
              <span
                className="admin-bars__fill"
                style={{ width: max === 0 ? "0%" : `${Math.max((day.count / max) * 100, day.count > 0 ? 4 : 0)}%` }}
              />
            </span>
            <span className="admin-bars__count tnum">{day.count}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm muted">Days are UTC.</p>
    </section>
  );
}
