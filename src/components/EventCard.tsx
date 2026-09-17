/**
 * The unit of the whole app: everything a player needs to decide, plus the
 * decision itself.
 */

import { Link } from "react-router";
import type { EventSummary } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { attendanceLabel } from "../lib/attendance";
import { formatEventDateTime, toDateTimeAttr } from "../lib/datetime";
import { MapLink } from "./MapLink";
import { SeatChip } from "./SeatChip";
import { RsvpButton } from "./RsvpButton";

export function EventCard({
  event,
  joined = false,
  showRsvp = false,
}: {
  event: EventSummary;
  joined?: boolean;
  /** Only players get a button; organizers see the same card, read-only. */
  showRsvp?: boolean;
}) {
  return (
    <article className="card">
      <Link className="card__link" to={`/events/${event.id}`}>
        <span className="card__title">{event.title}</span>
        {/* The head count rides on the date line, not in the action row: that
            row has 43px of slack on a joined card at 390px, so a tag there
            wraps exactly where the RSVP button needs to stay put. */}
        <span className="card__meta">
          <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventDateTime(event.startsAt)}</time>
          {" · "}
          {attendanceLabel(event.attendeeCount)}
        </span>
        <span className="card__meta">
          <span className="badge">{gameTypeLabel(event.gameType)}</span> Hosted by {event.organizerName}
        </span>
      </Link>
      {/* A sibling of the card link, never a child: an `<a>` cannot nest in an
          `<a>`, and the stretched-link trick that hides the nesting from the
          browser still breaks text selection on the address you want to read. */}
      <MapLink event={event} />
      <div className="card__row">
        <SeatChip
          seatsLeft={event.seatsLeft}
          capacity={event.capacity}
          isFull={event.isFull}
          joined={joined}
          status={event.status}
        />
        {showRsvp ? (
          <RsvpButton
            eventId={event.id}
            title={event.title}
            isFull={event.isFull}
            joined={joined}
            startsAt={event.startsAt}
            status={event.status}
          />
        ) : null}
      </div>
    </article>
  );
}
