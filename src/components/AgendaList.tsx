/**
 * Day-grouped event cards.
 *
 * The day headings themselves live in `DayGroupedList`, which the organizer's
 * hosted list shares with a different card. This is the player-facing pairing:
 * grouped days plus the RSVP-able `EventCard`.
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
import type { DayGroup } from "../lib/calendar";
import { DayGroupedList } from "./DayGroupedList";
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
    <DayGroupedList groups={groups} busy={busy}>
      {(event) => <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={showRsvp} />}
    </DayGroupedList>
  );
}
