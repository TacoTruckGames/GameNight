/**
 * A list of events under day headings — "Fri, Sep 18 · 3 events".
 *
 * Only the grouping shell lives here, because the three lists that want it do
 * not agree on the card. A player's board and My events render an `EventCard`
 * that links to the public detail page and carries an RSVP button; the
 * organizer's own list renders a card that links to the door list and counts
 * attendees instead. Same headings, different rows, so the row is a render
 * prop and the heading is written once.
 *
 * The alternative — copying six lines of `.agenda` markup into each page — is
 * how the board and My events drifted apart for a week in the first place.
 */

import type { ReactNode } from "react";
import { eventCountLabel, formatDayHeading, type DayGroup } from "../lib/calendar";

export function DayGroupedList<T extends { id: string }>({
  groups,
  busy,
  children,
}: {
  groups: DayGroup<T>[];
  busy?: boolean;
  /** Renders one event's card. Called once per event, in order. */
  children: (event: T) => ReactNode;
}) {
  return (
    <div className="stack stack--loose" aria-busy={busy}>
      {groups.map((group) => (
        <section className="agenda" key={group.key}>
          <h2 className="agenda__head">
            {formatDayHeading(group.key)}{" "}
            <span className="agenda__count">· {eventCountLabel(group.events.length)}</span>
          </h2>
          <ul className="stack">
            {group.events.map((event) => (
              <li key={event.id}>{children(event)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
