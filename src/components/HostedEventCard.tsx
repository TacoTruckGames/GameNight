/**
 * The organizer's row — links to the door list and counts attendees instead of
 * offering RSVP, because on `/organize` the decision has already been made.
 *
 * It shares the past treatment with `EventCard` (greyed card, "Past" badge,
 * "Ended" seat chip) because a finished night looks finished whoever is looking
 * at it — and the week agenda pages back through finished nights on purpose.
 */

import { Link } from "react-router";
import type { EventSummary } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { formatEventDateTime, isPastEvent, toDateTimeAttr } from "../lib/datetime";
import { MapLink } from "./MapLink";
import { SeatChip } from "./SeatChip";

export function HostedEventCard({ event }: { event: EventSummary }) {
  const past = isPastEvent(event.startsAt);

  return (
    <article className={past ? "card card--past" : "card"}>
      <Link className="card__link" to={`/organize/events/${event.id}`}>
        <span className="card__title">{event.title}</span>
        <span className="card__meta">
          <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventDateTime(event.startsAt)}</time>
        </span>
        <span className="card__meta">
          <span className="badge">{gameTypeLabel(event.gameType)}</span>
        </span>
      </Link>
      {/* Outside the card link — `<a>` cannot nest in `<a>`. */}
      <MapLink event={event} />
      <div className="card__row">
        <SeatChip
          seatsLeft={event.seatsLeft}
          capacity={event.capacity}
          isFull={event.isFull}
          status={event.status}
          past={past}
        />
        {/* Tense-neutral on purpose: this is the door list, before and after. */}
        <Link className="btn btn--sm btn--secondary" to={`/organize/events/${event.id}`}>
          {event.attendeeCount === 1 ? "1 attendee" : `${event.attendeeCount} attendees`}
        </Link>
      </div>
    </article>
  );
}
