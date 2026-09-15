/**
 * The honest count (S3), in three words or fewer.
 *
 * "You're in" wins over the seat count: once you have a seat, how many are
 * left is somebody else's problem.
 *
 * The icon repeats what the word says so the three states are still three
 * states without colour.
 */

import { Icon } from "./Icon";

export function SeatChip({
  seatsLeft,
  capacity,
  isFull,
  joined,
}: {
  seatsLeft: number;
  capacity: number;
  isFull: boolean;
  joined?: boolean;
}) {
  if (joined)
    return (
      <span className="seat-chip seat-chip--mine">
        <Icon name="in" size={16} />
        You're in
      </span>
    );
  if (isFull || seatsLeft <= 0)
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
