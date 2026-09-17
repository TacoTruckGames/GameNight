/**
 * One event, everything an operator can do to it.
 *
 * The edit form *is* `EventForm` — the organizer's — handed the admin's patch
 * hook (which audits) and its two operator extras. It used to be a 290-line
 * copy with a header claiming otherwise. After a save the page remounts the
 * form on a fresh key, so the inputs show what the server actually stored (a
 * trimmed title, a rounded time) without an effect syncing state to props.
 */

import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AdminEventDetail } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventForm } from "../components/EventForm";
import { MapLink } from "../components/MapLink";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, formatEventDateTimeLong, toDateTimeAttr } from "../lib/datetime";
import { AdminPage } from "./AdminNav";
import { useAdminEvent, usePatchEvent, useRemoveAttendee, useSetEventStatus } from "./hooks";

function EditForm({ event }: { event: AdminEventDetail }) {
  const patchEvent = usePatchEvent(event.id);
  // The key is the stored values, so the form remounts exactly when a refetch
  // brings different ones — after a save lands, not when the save is sent, and
  // never on a background refresh that changed nothing. That is the effect the
  // old copy had, expressed without an effect. `place?.id`, not `place`: the
  // object is a fresh reference on every fetch.
  const stored = [
    event.title,
    event.gameType,
    event.startsAt,
    event.location,
    event.place?.id ?? "",
    event.description ?? "",
    event.capacity,
  ].join("\u0001");
  // "Discard" remounts too, on the same values.
  const [discards, setDiscards] = useState(0);
  return (
    <EventForm
      key={`${stored}|${discards}`}
      event={event}
      mutation={patchEvent}
      venueTools
      onDone={() => setDiscards((n) => n + 1)}
    />
  );
}

function Attendees({ event }: { event: AdminEventDetail }) {
  const remove = useRemoveAttendee(event.id);

  return (
    <section className="stack">
      <h2 className="card__title">
        Attendees <span className="muted tnum">({event.attendees.length})</span>
      </h2>
      {event.attendees.length === 0 ? (
        <EmptyState title="Nobody has RSVP'd" hint="Seats released here go straight back on the board." />
      ) : (
        <ul className="stack">
          {event.attendees.map((attendee) => (
            <li className="card" key={attendee.playerId}>
              <div className="admin-row">
                <span>{attendee.name}</span>
                <span className="text-sm muted">
                  RSVP'd <time dateTime={toDateTimeAttr(attendee.rsvpAt)}>{formatEventDateTime(attendee.rsvpAt)}</time>
                </span>
              </div>
              <div className="admin-actions admin-actions--split">
                <span className="card__meta admin-mono">{attendee.playerId}</span>
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Remove ${attendee.name} from "${event.title}"? Their seat is released.`))
                      return;
                    remove.mutate({ playerId: attendee.playerId, name: attendee.name });
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminEventDetailPage() {
  const { id = "" } = useParams();
  const event = useAdminEvent(id);
  const setStatus = useSetEventStatus(id);

  if (event.isPending) {
    return (
      <AdminPage title="Event" subtitle="Loading…">
        <div className="stack" role="status" aria-busy="true" aria-label="Loading event">
          <Skeleton width="80%" height={28} />
          <Skeleton height={120} />
          <Skeleton height={320} />
        </div>
      </AdminPage>
    );
  }

  if (event.isError) {
    return (
      <AdminPage title="Event" subtitle="That event could not be loaded.">
        <ErrorBanner error={event.error} onRetry={() => void event.refetch()} />
        <Link to="/admin/events">← All events</Link>
      </AdminPage>
    );
  }

  const detail = event.data;
  const cancelled = detail.status === "cancelled";

  return (
    <AdminPage title={detail.title} subtitle="Edit it, cancel it, or release a seat.">
      <Link to="/admin/events" className="text-sm">
        ← All events
      </Link>

      <section className="card">
        <div className="stack">
          <p>
            <time dateTime={toDateTimeAttr(detail.startsAt)}>{formatEventDateTimeLong(detail.startsAt)}</time>{" "}
            <span className="muted">(your local time)</span>
          </p>
          <MapLink event={detail} />
          {detail.place && detail.place.address !== detail.location ? (
            <p className="text-sm muted">{detail.place.address}</p>
          ) : null}
          <p className="card__meta">
            <span className="badge">{gameTypeLabel(detail.gameType)}</span> Hosted by {detail.organizerName}{" "}
            <span className="admin-mono">{detail.organizerId}</span>
          </p>
          <div className="card__row">
            <SeatChip
              seatsLeft={detail.seatsLeft}
              capacity={detail.capacity}
              isFull={detail.isFull}
              status={detail.status}
            />
            <span className="text-sm muted">
              Created <time dateTime={toDateTimeAttr(detail.createdAt)}>{formatEventDateTime(detail.createdAt)}</time>
            </span>
          </div>
          {cancelled && detail.cancelledAt ? (
            <p className="text-sm muted">
              Cancelled{" "}
              <time dateTime={toDateTimeAttr(detail.cancelledAt)}>{formatEventDateTime(detail.cancelledAt)}</time>. It
              is hidden from the board and refuses new RSVPs; the list below is kept.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={cancelled ? "btn btn--block btn--secondary" : "btn btn--block btn--danger"}
          disabled={setStatus.isPending}
          aria-busy={setStatus.isPending}
          onClick={() => {
            if (cancelled) {
              setStatus.mutate("restore");
              return;
            }
            if (
              !window.confirm(
                `Cancel "${detail.title}"? It disappears from the board and nobody new can RSVP. Existing RSVPs are kept and can be restored.`,
              )
            )
              return;
            setStatus.mutate("cancel");
          }}
        >
          {setStatus.isPending ? "Working…" : cancelled ? "Restore event" : "Cancel event"}
        </button>
      </section>

      <EditForm event={detail} />
      <Attendees event={detail} />
    </AdminPage>
  );
}
