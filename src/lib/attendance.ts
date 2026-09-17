/**
 * How many people are coming, as a phrase.
 *
 * The seat chip answers "can I get in?" with seats left; this answers the other
 * question a player asks before committing — "will anyone be there?" — and it
 * is also the `current attendee count` the brief asks the board to show, which
 * "7 of 16 seats left" only implies by subtraction.
 *
 * Zero gets words rather than a bare "0 Going", which reads like a verdict on
 * the event rather than a fact about the clock. Past tense follows the clock
 * too: "6 Went" on a finished night, not "6 Going".
 *
 * Title case because these are chips, not sentences — they sit beside "Seats
 * Left" and "FULL", and a lowercase one among them reads as a fragment of a
 * sentence whose beginning is missing.
 */

export function attendanceLabel(attendeeCount: number, past = false): string {
  if (past) return attendeeCount <= 0 ? "No attendees" : `${attendeeCount} Went`;
  if (attendeeCount <= 0) return "No one yet";
  return `${attendeeCount} Going`;
}
