/**
 * One tap, on the card.
 *
 * The primary user is on a phone on a commute, so RSVP does not live behind a
 * detail page — the card is the decision point. The button never guesses: it
 * shows a pending label while the server decides and the surrounding card only
 * changes after the refetch (see `api/hooks.ts` on why there are no optimistic
 * updates).
 */

import type { EventStatus } from "../../shared/api-types";
import { useCancelRsvp, useRsvp } from "../api/hooks";

export function RsvpButton({
  eventId,
  title,
  isFull,
  joined,
  startsAt,
  status,
  block = false,
}: {
  eventId: string;
  /** Used for the accessible name, so a screen-reader list isn't 20 "RSVP"s. */
  title: string;
  isFull: boolean;
  joined: boolean;
  startsAt: string;
  status?: EventStatus;
  block?: boolean;
}) {
  const rsvp = useRsvp(eventId);
  const cancel = useCancelRsvp(eventId);

  const pending = rsvp.isPending || cancel.isPending;
  const started = new Date(startsAt).getTime() <= Date.now();
  const cancelled = status === "cancelled";
  const className = `btn btn--sm${block ? " btn--block" : ""}`;

  // Cancelling your own RSVP stays available on a cancelled event — clearing it
  // off your list is the one thing you might still want to do, and the API
  // allows DELETE (only PUT is refused with `EVENT_CANCELLED`).
  if (joined) {
    return (
      <button
        type="button"
        className={`${className} btn--danger`}
        onClick={() => cancel.mutate()}
        disabled={pending}
        aria-busy={pending}
        aria-label={`Cancel your RSVP for ${title}`}
      >
        {cancel.isPending ? "Cancelling…" : "Cancel RSVP"}
      </button>
    );
  }

  // Nothing to offer: the event is off, and you have no seat to release.
  if (cancelled) return null;

  if (started) {
    return (
      <button type="button" className={`${className} btn--secondary`} disabled>
        Started
      </button>
    );
  }

  if (isFull) {
    return (
      <button type="button" className={`${className} btn--secondary`} disabled aria-label={`${title} is full`}>
        Full
      </button>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => rsvp.mutate()}
      disabled={pending}
      aria-busy={pending}
      aria-label={`RSVP to ${title}`}
    >
      {rsvp.isPending ? "Saving…" : "RSVP"}
    </button>
  );
}
