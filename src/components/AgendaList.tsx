/**
 * Day-grouped event cards.
 *
 * Used twice: the agenda passes every group, the calendar's selected-day pane
 * passes exactly one — so a day reads the same whichever way you arrived at it,
 * heading included.
 *
 * The card keeps its own date line even under a date heading. It is the same
 * card everywhere in the app, and a card that changed shape depending on its
 * container would be a second card to maintain.
 */

import type { EventSummary } from "../../shared/api-types";
import { eventCountLabel, formatDayHeading, type DayGroup } from "../lib/calendar";
import { EventCard } from "./EventCard";

export function AgendaList({
  groups,
  myRsvpIds,
  showRsvp,
  busy,
}: {
  groups: DayGroup<EventSummary>[];
  myRsvpIds: Set<string>;
  showRsvp: boolean;
  busy?: boolean;
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
              <li key={event.id}>
                <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={showRsvp} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
