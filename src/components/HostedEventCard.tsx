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
 * The one difference that is not cosmetic: the meta line leads with who is
 * coming, not with whether you can get in. An organizer's first question about
 * their own table is "how many turned up"; the seats follow, in the player's
 * words, because the second question is "against how many".
 */

import { Link, useLocation } from "react-router";
import type { EventSummary } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { attendanceLabel } from "../lib/attendance";
import { formatEventTime, isPastEvent, toDateTimeAttr } from "../lib/datetime";
import { Icon } from "./Icon";
import { MapLink } from "./MapLink";
import { seatState, seatsLeftLabel } from "./SeatChip";

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

      {/* "5 Going · 3/8 Seats Left · Card games", or "8 Going · Full · …". The
          head count alone left the one thing an organizer acts on to arithmetic
          — 5 going looks the same at a table of 8 and a table of 20 until you go
          and find the capacity — so the seats follow it, in the same words the
          player's card and the sheet use for the same fact. Cancelled outranks
          it, and a finished night is not a seating question at all. */}
      <span className={`ecard__meta ecard__meta--${state === "joined" ? "open" : state}`}>
        {state === "cancelled" ? "Cancelled" : attendanceLabel(event.attendeeCount, past)}
        {state === "full"
          ? " · Full"
          : state === "open"
            ? ` · ${seatsLeftLabel(event.seatsLeft, event.capacity)}`
            : ""}{" "}
        · {gameTypeLabel(event.gameType)}
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
