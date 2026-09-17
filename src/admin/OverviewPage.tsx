/**
 * What is going on right now, in one screen.
 *
 * Counts first (every tile is a link into the list it counts), then two 14-day
 * bars for shape, then the audit trail — "what did the last admin do" is the
 * first question when two people share the job. The probe button at the bottom
 * proves the error pipeline works end to end without waiting for a real bug.
 */

import type { AuditAction, AuditEntry } from "../../shared/api-types";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, toDateTimeAttr } from "../lib/datetime";
import { AdminPage } from "./AdminNav";
import { DayBars } from "./DayBars";
import { StatTile } from "./StatTile";
import { useAdminOverview, useProbeError } from "./hooks";

const ACTION_LABELS: Record<AuditAction, string> = {
  "user.suspended": "suspended",
  "user.unsuspended": "unsuspended",
  "event.updated": "edited event",
  "event.cancelled": "cancelled event",
  "event.restored": "restored event",
  "event.attendee_removed": "removed an attendee from",
  "error.resolved": "resolved error",
  "error.dismissed": "dismissed error",
};

function ActionRow({ entry }: { entry: AuditEntry }) {
  const changed = entry.metadata?.["changed"];
  return (
    <li className="card">
      <div className="admin-row">
        <span>
          <strong>{entry.actorName}</strong> {ACTION_LABELS[entry.action] ?? entry.action}{" "}
          <span className="admin-mono">{entry.targetId}</span>
        </span>
        <span className="text-sm muted">
          <time dateTime={toDateTimeAttr(entry.createdAt)}>{formatEventDateTime(entry.createdAt)}</time>
        </span>
      </div>
      {Array.isArray(changed) && changed.length > 0 ? (
        <p className="text-sm muted">Changed: {changed.join(", ")}</p>
      ) : null}
    </li>
  );
}

export function AdminOverviewPage() {
  const overview = useAdminOverview();
  const probe = useProbeError();

  return (
    <AdminPage title="Admin" subtitle="The board at a glance, and the levers to fix it.">
      {overview.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading overview">
          <Skeleton height={180} />
          <Skeleton height={220} />
          <Skeleton height={220} />
        </div>
      ) : overview.isError ? (
        <ErrorBanner error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <section className="stack">
            <h2 className="card__title">People</h2>
            <div className="admin-stats">
              <StatTile label="Users" value={overview.data.users.total} to="/admin/users" />
              <StatTile label="Players" value={overview.data.users.players} to="/admin/users?role=player" />
              <StatTile label="Organizers" value={overview.data.users.organizers} to="/admin/users?role=organizer" />
              <StatTile label="Suspended" value={overview.data.users.suspended} to="/admin/users?status=suspended" />
              <StatTile label="New" value={overview.data.users.newLast7d} hint="last 7 days" />
            </div>
          </section>

          <section className="stack">
            <h2 className="card__title">Events</h2>
            <div className="admin-stats">
              <StatTile label="Upcoming" value={overview.data.events.upcoming} to="/admin/events?when=upcoming" />
              <StatTile label="Full" value={overview.data.events.full} to="/admin/events?when=upcoming" />
              <StatTile
                label="Cancelled"
                value={overview.data.events.cancelled}
                to="/admin/events?when=all&status=cancelled"
              />
              <StatTile label="Past" value={overview.data.events.past} to="/admin/events?when=past" />
            </div>
          </section>

          <section className="stack">
            <h2 className="card__title">RSVPs &amp; errors</h2>
            <div className="admin-stats">
              <StatTile label="RSVPs" value={overview.data.rsvps.total} hint="all time" />
              <StatTile label="RSVPs" value={overview.data.rsvps.last24h} hint="last 24 hours" />
              <StatTile label="RSVPs" value={overview.data.rsvps.last7d} hint="last 7 days" />
              <StatTile label="Open errors" value={overview.data.errors.open} to="/admin/errors?status=open" />
              <StatTile
                label="Errors"
                value={overview.data.errors.last24h}
                hint="last 24 hours"
                to="/admin/errors?status=all"
              />
            </div>
          </section>

          <DayBars title="Signups by day" days={overview.data.signupsByDay} />
          <DayBars title="RSVPs by day" days={overview.data.rsvpsByDay} />

          <section className="stack">
            <h2 className="card__title">Recent actions</h2>
            {overview.data.recentActions.length === 0 ? (
              <EmptyState title="No admin actions yet" hint="Suspensions and event edits are logged here." />
            ) : (
              <ul className="stack">
                {overview.data.recentActions.map((entry) => (
                  <ActionRow entry={entry} key={entry.id} />
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">Error pipeline</h2>
            <p className="text-sm muted">
              Throws a deliberate failure in the Worker so you can check that backend errors reach the Errors
              page. Safe to run in production.
            </p>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => probe.mutate()}
              disabled={probe.isPending}
              aria-busy={probe.isPending}
            >
              {probe.isPending ? "Sending…" : "Send test error"}
            </button>
          </section>
        </>
      )}
    </AdminPage>
  );
}
