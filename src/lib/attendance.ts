/**
 * How many people are coming, as a phrase.
 *
 * The seat chip answers "can I get in?" with seats left; this answers the other
 * question a player asks before committing — "will anyone be there?" — and it
 * is also the `current attendee count` the brief asks the board to show, which
 * "7 of 16 seats left" only implies by subtraction.
 *
 * Zero is "0 Going" — a number, like every other count on the board, so a
 * column of cards lines up and an organizer scanning for the empty table finds
 * a zero rather than a sentence. It used to be "No one yet", which read
 * gentler and sorted worse. Past tense follows the clock: "6 Went" on a
 * finished night, not "6 Going", and "0 Went" for the one nobody came to.
 *
 * Title case because these are chips, not sentences — they sit beside "Seats
 * Left" and "FULL", and a lowercase one among them reads as a fragment of a
 * sentence whose beginning is missing.
 */

export function attendanceLabel(attendeeCount: number, past = false): string {
  const count = Math.max(0, attendeeCount);
  return past ? `${count} Went` : `${count} Going`;
}
