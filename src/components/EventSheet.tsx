/**
 * The parts of an event sheet that are the same event from either side of
 * the table.
 *
 * The player's sheet (`EventDetailPage`) and the organizer's door list
 * (`AttendeesPage`) used to build each of these separately — the header, the
 * facts row, the venue block — with the same ten-line comment pasted over the
 * header in both files. They differ in the action slot and in whether a guest
 * list follows, and now that is all they differ in.
 *
 * ## The header
 *
 * Kind, name, when — in that order, because that is the order the questions
 * arrive in. The date sits outside the card and is set large: it used to be the
 * fifth thing on the page, below a map. Who is hosting is *not* up here. It is
 * the one fact on the sheet nobody is deciding on — it settles nothing about
 * whether to go — so it sits at the foot of the card, under the action, the
 * way a byline sits under an article rather than over its headline.
 *
 * ## The facts
 *
 * Three separate facts, because they are three: whether *you* have a seat,
 * whether the table has any, and how many people that is. They used to be two,
 * with the first pair crammed into one pill. The organizer sees the same two
 * chips in the same words — "12 seats taken" was the same number said from the
 * other side of the table, and an organizer comparing their listing to what a
 * player reads should not have to translate.
 *
 * ## The venue
 *
 * The label you can tap, the address Google confirmed (only when it adds
 * something the label does not already say), and the map. No Directions
 * button: where there is a map it was the same tap twice — the map is itself a
 * link to that URL. Where there is none the venue is free text Google never
 * confirmed, and turn-by-turn to "Greenwood House, dining room" is a promise
 * nobody can keep. The label is a link to a Maps *search* for the same words,
 * which is the honest version of the same offer — a search that finds nothing
 * shows you it found nothing.
 */

import type { EventPlace, EventStatus } from "../../shared/api-types";
import { gameTypeLabel, type GameType } from "../../shared/game-types";
import { attendanceLabel } from "../lib/attendance";
import { formatEventWhen, toDateTimeAttr } from "../lib/datetime";
import { EventMiniMap } from "./EventMiniMap";
import { Icon } from "./Icon";
import { MapLink } from "./MapLink";
import { GoingChip, SeatChip } from "./SeatChip";

export function EventSheetHeader({ event }: { event: { gameType: GameType; title: string; startsAt: string } }) {
  return (
    <div className="detail__head">
      <span className="detail__kind">{gameTypeLabel(event.gameType)}</span>
      <h1 className="page-title">{event.title}</h1>
      <p className="detail__when">
        <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventWhen(event.startsAt)}</time>
      </p>
    </div>
  );
}

export function EventFacts({
  event,
  attendeeCount,
  past,
  joined = false,
}: {
  event: { seatsLeft: number; capacity: number; isFull: boolean; status: EventStatus };
  /** The organizer's door list counts the names it was handed; the player's sheet reads the column. */
  attendeeCount: number;
  past: boolean;
  /** The reader holds a seat. Shown only while it still means something — not on a finished or cancelled night. */
  joined?: boolean;
}) {
  return (
    <div className="detail__facts">
      {joined && !past && event.status !== "cancelled" ? <GoingChip /> : null}
      <SeatChip seatsLeft={event.seatsLeft} capacity={event.capacity} isFull={event.isFull} status={event.status} past={past} />
      <span className="badge badge--count">
        <Icon name="player" size={14} />
        {attendanceLabel(attendeeCount, past)}
      </span>
    </div>
  );
}

export function EventVenue({
  event,
  showMap,
}: {
  event: { id: string; location: string; place: EventPlace | null };
  /** `useMapsConfig().map` — a deployment with no key has no map to show. */
  showMap: boolean;
}) {
  return (
    <div className="venue">
      <MapLink event={event} className="card__address venue__link" withAddress />
      {event.place !== null && showMap ? (
        <EventMiniMap eventId={event.id} place={event.place} location={event.location} />
      ) : null}
    </div>
  );
}
