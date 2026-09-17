/**
 * The honest count (S3), in a handful of words.
 *
 * On the sheet this answers one question — how full is the table — and nothing
 * else. Whether *you* are going is a different question with a different answer
 * shape, so it is a different chip (`GoingChip`); the two used to be crammed
 * into one pill as "Going · 5 of 16 left", which read as one fact and is two.
 *
 * The card still needs them as one line, and gets it from `seatLabel` below.
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
      {seatsLeft} / {capacity} Seats Left
    </span>
  );
}

/**
 * "Going" — that *you* are, in green, on its own.
 *
 * Its own chip rather than a prefix on the seat count, because it answers a
 * different question: the seat chip says how full the table is, this says
 * whether you have one of them. Tick plus green, so the colour is never the
 * only thing carrying it.
 */
export function GoingChip() {
  return (
    <span className="seat-chip seat-chip--mine">
      <Icon name="in" size={16} />
      Going
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
      // "Full", not "table full": it is the same fact the next case states, and
      // a card that says one of them one way and the other another way reads as
      // two different facts.
      return seatsLeft <= 0 ? "Going · Full" : `Going · ${seatsLeft} of ${capacity} left`;
    case "full":
      return "Full";
    default:
      return `${seatsLeft} of ${capacity} left`;
  }
}
