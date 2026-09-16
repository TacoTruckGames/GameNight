/**
 * The honest count (S3), in a handful of words.
 *
 * "You're in" leads once you have a seat — but it no longer *replaces* the
 * count. How full the table is stays useful after you join: it is what you
 * check before telling a friend to grab a seat, and the board, My events and
 * the detail page all render this same chip.
 *
 * The icon repeats what the leading word says so the states are still distinct
 * states without colour.
 *
 * "Cancelled" outranks everything, including "You're in": if an admin pulled the
 * event, how many seats are left — and whether you had one — stopped mattering.
 */

import type { EventStatus } from "../../shared/api-types";
import { Icon } from "./Icon";

export function SeatChip({
  seatsLeft,
  capacity,
  isFull,
  joined,
  status,
}: {
  seatsLeft: number;
  capacity: number;
  isFull: boolean;
  joined?: boolean;
  status?: EventStatus;
}) {
  if (status === "cancelled")
    return (
      <span className="seat-chip seat-chip--cancelled">
        <Icon name="alert" size={16} />
        Cancelled
      </span>
    );
  const full = isFull || seatsLeft <= 0;
  if (joined)
    // A middle dot rather than a second sentence: the chip is one nowrap line
    // and has to survive a 390px-wide card next to the RSVP button.
    return (
      <span className="seat-chip seat-chip--mine">
        <Icon name="in" size={16} />
        You're in · {full ? "table full" : `${seatsLeft} of ${capacity} left`}
      </span>
    );
  if (full)
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
