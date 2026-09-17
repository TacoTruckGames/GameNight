/**
 * The unit of the whole app: everything a player needs to decide, plus the
 * decision itself — in three lines and 88px.
 *
 * It was 222px, and 66px of that was padding and gaps. What went, and why:
 *
 * - **The date.** Every list that renders this card renders it under a
 *   `DayGroupedList` heading that already says "Thu, Sep 17 · 2 events". The
 *   card was repeating the day it is filed under; only the *time* was new, and
 *   the time now has the rail to itself.
 * - **The host.** Real, but not a decision input at the moment of scanning a
 *   board. It is on the detail sheet, one tap away.
 * - **"9 going".** `7 of 16 left` and `9 going` are the same fact said twice —
 *   the attendee count is `capacity - seatsLeft`. The board keeps the one that
 *   answers "can I get in?"; the sheet keeps both.
 * - **The venue's tap target.** `MapLink` is a link, so it claimed a full 44px
 *   row for muted secondary text. It was a link here only because the card is
 *   also a link and `<a>` cannot nest in `<a>`; the deep link belongs on the
 *   sheet, where there is room. Here the venue is plain text.
 *
 * The layout is a 3×3 grid, and one placement does the real work: the **title
 * spans to the card's right edge**, and the action sits below it rather than
 * beside it. A button next to a title truncates the title; a button under it
 * cannot. The action then costs no row of its own either — it is 44px against
 * two 13px lines, so it sets that band's height and the card stays at three
 * lines plus padding.
 */

import { Link, useLocation } from "react-router";
import type { EventSummary } from "../../shared/api-types";
import { gameTypeLabel } from "../../shared/game-types";
import { isPastEvent } from "../lib/datetime";
import { formatEventTime, toDateTimeAttr } from "../lib/datetime";
import { MapLink } from "./MapLink";
import { seatLabel, seatState } from "./SeatChip";
import { RsvpButton } from "./RsvpButton";

export function EventCard({
  event,
  joined = false,
  showRsvp = false,
}: {
  event: EventSummary;
  joined?: boolean;
  /** Only players get a button; organizers see the same card, read-only. */
  showRsvp?: boolean;
}) {
  // Past events reach a card through the calendar's day pane, where a finished
  // night otherwise looks exactly like one you can still join.
  const past = isPastEvent(event.startsAt);
  const state = seatState({ ...event, joined, past });
  const { hour, suffix } = formatEventTime(event.startsAt);
  // Handing the current location to the link is what tells `routes.tsx` to open
  // the event *over* this list instead of replacing it — so the board keeps its
  // scroll position and closing is Back. The URL is the same either way, so the
  // link is still one you can copy and send.
  const location = useLocation();

  return (
    <article className={`ecard${past ? " ecard--past" : ""}`}>
      {/* The rail is `aria-hidden` and the time is repeated in the link's own
          accessible name: read aloud, "7:30 PM Midweek Modern Night" is a
          sentence, while a bare "7:30 / PM" before it is two stray numbers. */}
      <span className="ecard__rail" aria-hidden="true">
        <span className="ecard__hour tnum">{hour}</span>
        <span className="ecard__suffix">{suffix}</span>
      </span>

      <Link className="ecard__title" to={`/events/${event.id}`} state={{ backgroundLocation: location }}>
        <time className="visually-hidden" dateTime={toDateTimeAttr(event.startsAt)}>
          {hour} {suffix}
        </time>{" "}
        {event.title}
      </Link>

      <span className={`ecard__meta ecard__meta--${state}`}>
        {seatLabel(state, event.seatsLeft, event.capacity)} · {gameTypeLabel(event.gameType)}
      </span>

      {/* A sibling of the title link, never a child — and no longer a link
          itself, so it costs one line instead of a tap target. The title's
          stretched `::after` covers this, which is what makes the whole card
          open the event; the RSVP button lifts itself back above it. */}
      <MapLink event={event} compact />

      {showRsvp ? (
        <RsvpButton
          eventId={event.id}
          title={event.title}
          isFull={event.isFull}
          joined={joined}
          startsAt={event.startsAt}
          status={event.status}
        />
      ) : null}
    </article>
  );
}
