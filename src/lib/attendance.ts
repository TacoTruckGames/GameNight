/**
 * How many people are coming, as a phrase.
 *
 * The seat chip answers "can I get in?" with seats left; this answers the other
 * question a player asks before committing — "will anyone be there?" — and it
 * is also the `current attendee count` the brief asks the board to show, which
 * "7 of 16 seats left" only implies by subtraction.
 *
 * Zero gets words rather than a bare "0 going", which reads like a verdict on
 * the event rather than a fact about the clock. Past tense follows the clock
 * too: "6 went" on a finished night, not "6 going".
 */

export function attendanceLabel(attendeeCount: number, past = false): string {
  if (past) return attendeeCount <= 0 ? "No attendees" : `${attendeeCount} went`;
  if (attendeeCount <= 0) return "No one yet";
  return `${attendeeCount} going`;
}
