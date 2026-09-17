/**
 * The honest count (S3), in a handful of words.
 *
 * "Going" leads once you have a seat — but it no longer *replaces* the count.
 * How full the table is stays useful after you join: it is what you check
 * before telling a friend to grab a seat, and the board, My RSVP and the detail
 * page all render this same state.
 *
 * "Going" rather than "You're in": one word instead of three, in a line that
 * also has to carry the seat count and the game type on an 88px card, and it
 * is the word the rest of the product already uses for the same fact ("9
 * going"). Green plus a tick still says it is *your* state, not the table's.
 *
 * The icon repeats what the leading word says so the states are still distinct
 * states without colour.
 *
 * "Cancelled" outranks everything, including "Going": if an admin pulled the
 * event, how many seats are left — and whether you had one — stopped mattering.
 *
 * "Ended" comes next, for the same reason in a gentler form. A finished night is
 * not a seating question, and a greyed past card that still offered "9 of 15
 * seats left" would be arguing with itself. How many actually came is on the
 * card's date line, which is the right place for it.
 */

import type { EventStatus } from "../../shared/api-types";
import { Icon } from "./Icon";

/**
 * Which of the five things a table can be, decided once.
 *
 * The chip below and the card's own one-line version of the same fact have to
 * agree, and they used to agree only because two `if` ladders happened to be
 * written in the same order. This is that ladder, exported: cancelled outranks
 * everything, then a finished night, then your own seat, then a full table.
 */
export type SeatState = "cancelled" | "past" | "joined" | "full" | "open";

export function seatState(event: {
  isFull: boolean;
  seatsLeft: number;
  status?: EventStatus;
  joined?: boolean;
  past?: boolean;
}): SeatState {
  if (event.status === "cancelled") return "cancelled";
  if (event.past) return "past";
  if (event.joined) return "joined";
  if (event.isFull || event.seatsLeft <= 0) return "full";
  return "open";
}

export function SeatChip({
  seatsLeft,
  capacity,
  isFull,
  joined,
  status,
  past = false,
}: {
  seatsLeft: number;
  capacity: number;
  isFull: boolean;
  joined?: boolean;
  status?: EventStatus;
  /** Already happened. Outranks every seating state except "Cancelled". */
  past?: boolean;
}) {
  const state = seatState({ isFull, seatsLeft, status, joined, past });
  const full = isFull || seatsLeft <= 0;

  if (state === "cancelled")
    return (
      <span className="seat-chip seat-chip--cancelled">
        <Icon name="alert" size={16} />
        Cancelled
      </span>
    );
  if (state === "past")
    return (
      <span className="seat-chip seat-chip--past">
        <Icon name="empty" size={16} />
        Ended
      </span>
    );
  if (state === "joined")
    // A middle dot rather than a second sentence: the chip is one nowrap line
    // and has to survive a 390px-wide card next to the RSVP button.
    return (
      <span className="seat-chip seat-chip--mine">
        <Icon name="in" size={16} />
        Going · {full ? "table full" : `${seatsLeft} of ${capacity} left`}
      </span>
    );
  if (state === "full")
    return (
      <span className="seat-chip seat-chip--full">
        <Icon name="full" size={16} />
        FULL
      </span>
    );
  return (
    <span className="seat-chip seat-chip--open">
      <Icon name="seat" size={16} />
      {seatsLeft} of {capacity} seats left
    </span>
  );
}

/**
 * The same five states as one line of text, for the card.
 *
 * The chip is a pill with an icon and needs a row to itself; the card has three
 * short lines and no room for one, so this says the same thing in the meta
 * line's own voice. Colour is carried by the caller's class, never by this
 * string — "Full" and "Going" read as themselves in a screen reader.
 */
export function seatLabel(state: SeatState, seatsLeft: number, capacity: number): string {
  switch (state) {
    case "cancelled":
      return "Cancelled";
    case "past":
      return "Ended";
    case "joined":
      return seatsLeft <= 0 ? "Going · table full" : `Going · ${seatsLeft} of ${capacity} left`;
    case "full":
      return "Full";
    default:
      return `${seatsLeft} of ${capacity} left`;
  }
}
