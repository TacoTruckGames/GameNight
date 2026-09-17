/**
 * The organizer's door list for one event: who's coming, in the order they
 * RSVP'd. Owner-only — a 403 from the API shows as a plain sentence, not a
 * broken page.
 *
 * Two frames, exactly as `EventDetailPage` has: tapped from a card on the
 * organizer's board it is a sheet over that board, and a typed URL, a shared
 * link or a refresh renders the same thing as a full page. `routes.tsx` decides
 * from the navigation's own state; everything below is identical in both.
 *
 * It carries the venue's map for the same reason the player's sheet does — an
 * organizer standing outside the building wants directions as much as anyone,
 * and the door list is the page they will have open when they are.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { gameTypeLabel } from "../../shared/game-types";
import { useAttendees, useMapsConfig } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventForm } from "../components/EventForm";
import { EventMiniMap } from "../components/EventMiniMap";
import { MapLink } from "../components/MapLink";
import { SeatChip } from "../components/SeatChip";
import { Sheet } from "../components/Sheet";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, formatEventWhen, toDateTimeAttr } from "../lib/datetime";

export function AttendeesPage({ asSheet = false }: { asSheet?: boolean }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const attendees = useAttendees(id);
  const maps = useMapsConfig({ enabled: true });
  const [editing, setEditing] = useState(false);
  const close = () => navigate(-1);

  if (attendees.isPending) {
    return (
      <div className="stack" role="status" aria-busy="true" aria-label="Loading attendees">
        <Skeleton width="70%" height={28} />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }

  if (attendees.isError) {
    return (
      <div className="stack">
        <ErrorBanner error={attendees.error} onRetry={() => void attendees.refetch()} />
        <Link to="/">Back to our events</Link>
      </div>
    );
  }

  const { event, attendees: list } = attendees.data;

  const body = (
    <>
      {asSheet ? null : (
        <Link to="/" className="text-sm">
          ← Our events
        </Link>
      )}

      {/* The same header on both sheets, because it is the same event and the
          organizer reviewing their own listing is checking exactly what a player
          would read. Kind, name, when — in that order, because that is the order
          the questions arrive in. The date sits outside the card and is set
          large: it used to be the fifth thing on the page, below a map.

          Who is hosting is *not* up here. It is the one fact on the sheet nobody
          is deciding on — it settles nothing about whether to go — so it sits at
          the foot of the card, under the action, the way a byline sits under an
          article rather than over its headline. */}
      <div className="detail__head">
        <span className="detail__kind">{gameTypeLabel(event.gameType)}</span>
        <h1 className="page-title">{event.title}</h1>
        <p className="detail__when">
          <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventWhen(event.startsAt)}</time>
        </p>
      </div>

      <div className="card">
        <div className="stack">
          <div className="venue">
            <MapLink event={event} className="card__address venue__link" withAddress />
            {event.place && maps.map ? (
              <EventMiniMap eventId={event.id} place={event.place} location={event.location} />
            ) : null}
          </div>
          {/* The organizer's own words, the same way the player's sheet shows
              them. Absent is ordinary and renders as nothing at all. */}
          {event.description !== null ? <p className="text-lines">{event.description}</p> : null}
          <div className="detail__facts">
            <SeatChip
              seatsLeft={event.seatsLeft}
              capacity={event.capacity}
              isFull={event.isFull}
              status={event.status}
            />
            <span className="badge">{list.length === 1 ? "1 seat taken" : `${list.length} seats taken`}</span>
          </div>
        </div>
        {/* The board's cards open this page now, not the public one, so this is
            where Edit has to be — otherwise an organizer could only reach it by
            typing the player's URL for their own event. */}
        {event.status === "cancelled" || editing ? null : (
          <button type="button" className="btn btn--block" onClick={() => setEditing(true)}>
            Edit Event
          </button>
        )}
        <p className="detail__host">Hosted by {event.organizerName}</p>
      </div>

      {editing ? <EventForm event={event} onDone={() => setEditing(false)} /> : null}

      <h2 className="card__title">Who's coming</h2>

      {list.length === 0 ? (
        <EmptyState title="No RSVPs yet" hint="The event is live on the board with every seat open; names land here as players RSVP." />
      ) : (
        <ul className="stack" aria-busy={attendees.isFetching}>
          {list.map((attendee) => (
            <li key={attendee.playerId} className="card">
              <div className="card__row">
                <span>{attendee.name}</span>
                <span className="text-sm muted">
                  RSVP'd <time dateTime={toDateTimeAttr(attendee.rsvpAt)}>{formatEventDateTime(attendee.rsvpAt)}</time>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (!asSheet) return <div className="stack stack--loose">{body}</div>;

  return (
    <Sheet label={`${event.title} — who's coming`} onClose={close}>
      {body}
    </Sheet>
  );
}
