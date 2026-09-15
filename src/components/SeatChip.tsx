/**
 * The honest count (S3), in three words or fewer.
 *
 * "You're in" wins over the seat count: once you have a seat, how many are
 * left is somebody else's problem.
 */

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
  if (joined) return <span className="seat-chip seat-chip--mine">You're in</span>;
  if (isFull || seatsLeft <= 0) return <span className="seat-chip seat-chip--full">FULL</span>;
  return (
    <span className="seat-chip seat-chip--open">
      {seatsLeft} of {capacity} seats left
    </span>
  );
}
