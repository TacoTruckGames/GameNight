/**
 * The organizer's door list for one event: who's coming, in the order they
 * RSVP'd. Owner-only — a 403 from the API shows as a plain sentence, not a
 * broken page.
 */

import { Link, useParams } from "react-router";
import { useAttendees } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { MapLink } from "../components/MapLink";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, formatEventDateTimeLong, toDateTimeAttr } from "../lib/datetime";

export function AttendeesPage() {
  const { id = "" } = useParams();
  const attendees = useAttendees(id);

  if (attendees.isPending) {
    return (
      <div className="stack" role="status" aria-busy="true" aria-label="Loading attendees">
        <Skeleton width="70%" height={28} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }

  if (attendees.isError) {
    return (
      <div className="stack">
        <ErrorBanner error={attendees.error} onRetry={() => void attendees.refetch()} />
        <Link to="/organize">Back to your events</Link>
      </div>
    );
  }

  const { event, attendees: list } = attendees.data;

  return (
    <div className="stack stack--loose">
      <Link to="/organize" className="text-sm">
        ← Your events
      </Link>

      <div className="stack">
        <h1 className="page-title">{event.title}</h1>
        <p className="card__meta">
          <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventDateTimeLong(event.startsAt)}</time>
        </p>
        <MapLink event={event} />
        <div>
          <SeatChip
            seatsLeft={event.seatsLeft}
            capacity={event.capacity}
            isFull={event.isFull}
            status={event.status}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState title="No RSVPs yet" hint="Share the event — seats fill up fast." />
      ) : (
        <ul className="stack" aria-busy={attendees.isFetching}>
          {list.map((attendee) => (
            <li key={attendee.playerId} className="card">
              <div className="card__row">
                <span>{attendee.name}</span>
                <span className="text-sm muted">
                  RSVP'd <time dateTime={toDateTimeAttr(attendee.rsvpAt)}>{formatEventDateTime(attendee.rsvpAt)}</time>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
