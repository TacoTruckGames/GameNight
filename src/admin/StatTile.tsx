/**
 * One number and what it counts.
 *
 * Every tile is a link into the list it summarises — a number an operator can't
 * drill into is trivia, and "12 suspended" should be one tap from the twelve
 * names. `tabular-nums` so the grid doesn't jitter as counts change.
 */

import { Link } from "react-router";

export function StatTile({ label, value, to, hint }: { label: string; value: number; to?: string; hint?: string }) {
  const body = (
    <>
      <span className="admin-stat__value tnum">{value.toLocaleString()}</span>
      <span className="admin-stat__label">{label}</span>
      {hint ? <span className="admin-stat__hint">{hint}</span> : null}
    </>
  );

  if (!to) return <div className="admin-stat">{body}</div>;
  return (
    <Link className="admin-stat admin-stat--link" to={to}>
      {body}
    </Link>
  );
}
