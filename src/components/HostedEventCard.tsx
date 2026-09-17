/**
 * The organizer's row — the same 88px rail card as `EventCard`, with the door
 * list in the action slot instead of RSVP, because on `/organize` the decision
 * has already been made.
 *
 * It shares the anatomy and the past treatment deliberately: a finished night
 * looks finished whoever is looking at it, the week agenda pages back through
 * finished nights on purpose, and two cards that drifted apart once already
 * (see `DayGroupedList`) should not be given a second chance to.
 *
 * The one difference that is not cosmetic: the meta line says who is coming,
 * not whether you can get in. An organizer's question about their own table is
 * "how many turned up", and `seatLabel`'s "7 of 16 left" answers a question
 * they are not asking.
 */

import { Link, useLocation } from "react-router";
import type { EventSummary } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { attendanceLabel } from "../lib/attendance";
import { formatEventTime, isPastEvent, toDateTimeAttr } from "../lib/datetime";
import { Icon } from "./Icon";
import { MapLink } from "./MapLink";
import { seatState } from "./SeatChip";

export function HostedEventCard({ event }: { event: EventSummary }) {
  const past = isPastEvent(event.startsAt);
  const state = seatState({ ...event, past });
  const { hour, suffix } = formatEventTime(event.startsAt);
  const door = `/organize/events/${event.id}`;
  // Same as the player's card: hand the current location to the link and the
  // door list opens over this board instead of replacing it.
  const location = useLocation();

  return (
    <article className={`ecard${past ? " ecard--past" : ""}`}>
      <span className="ecard__rail" aria-hidden="true">
        <span className="ecard__hour tnum">{hour}</span>
        <span className="ecard__suffix">{suffix}</span>
      </span>

      <Link className="ecard__title" to={door} state={{ backgroundLocation: location }}>
        <time className="visually-hidden" dateTime={toDateTimeAttr(event.startsAt)}>
          {hour} {suffix}
        </time>{" "}
        {event.title}
      </Link>

      <span className={`ecard__meta ecard__meta--${state === "joined" ? "open" : state}`}>
        {state === "cancelled" ? "Cancelled" : attendanceLabel(event.attendeeCount, past)} ·{" "}
        {gameTypeLabel(event.gameType)}
      </span>

      {/* Covered by the title's stretched link, same as the player's card, so
          the whole row opens the door list. */}
      <MapLink event={event} compact />

      {/* A number and a person, because the slot is 70px and "10 attendees"
          does not fit in it — and the icon says the noun in less room than the
          noun does. Tense-neutral on purpose: this is the door list, before and
          after. The accessible name keeps the whole phrase. */}
      <Link
        className="btn btn--sm btn--secondary ecard__count"
        to={door}
        state={{ backgroundLocation: location }}
        aria-label={`${event.attendeeCount === 1 ? "1 person" : `${event.attendeeCount} people`} coming — open the door list`}
      >
        <span className="tnum">{event.attendeeCount}</span>
        <Icon name="player" size={15} />
      </Link>
    </article>
  );
}
