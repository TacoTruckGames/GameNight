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
import { useAttendees, useMapsConfig } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventDangerZone } from "../components/EventDangerZone";
import { EventForm } from "../components/EventForm";
import { EventFacts, EventSheetHeader, EventVenue } from "../components/EventSheet";
import { Sheet } from "../components/Sheet";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, isPastEvent, toDateTimeAttr } from "../lib/datetime";

export function AttendeesPage({ asSheet = false }: { asSheet?: boolean }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const attendees = useAttendees(id);
  const maps = useMapsConfig({ enabled: true });
  const [editing, setEditing] = useState(false);
  const close = () => void navigate(-1);

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
  const past = isPastEvent(event.startsAt);

  // The same two chips the player sees, in the same words — `EventSheet.tsx`
  // says why. Counted from the names this page was handed, not the column.
  const facts = <EventFacts event={event} attendeeCount={list.length} past={past} />;

  const body = (
    <>
      {asSheet ? null : (
        <Link to="/" className="text-sm">
          ← Our events
        </Link>
      )}

      {/* Two columns on a desktop, one on a phone. The event and the people
          coming to it are two things you read against each other — "twelve
          going, four seats left, do I open more" — and stacking them puts a map
          and a description between the question and its answer.

          It also gives back something edit mode had to take: on a phone the
          form replaces the read view, guest list included, because there is
          nowhere else for it. Beside, there is — so on a desktop the list stays
          up while you edit, which is exactly when you want to see it. */}
      <div className={`doorlist${editing ? " doorlist--editing" : ""}`}>
        <div className="doorlist__main stack stack--loose">
          {/* The same header as the player's sheet — `EventSheet.tsx`. */}
          <EventSheetHeader event={event} />

          {editing ? (
            <>
              {/* Editing replaces the read view rather than sitting under it. What
              stays is the header above and the two numbers here — head count and
              seats — because they are what every edit is made against: opening
              seats at a full table, moving a night twelve people have planned
              around. */}
              {facts}
              <EventForm event={event} onDone={() => setEditing(false)} />
              <EventDangerZone
                event={event}
                onCancelled={() => setEditing(false)}
                onDeleted={() => void (asSheet ? navigate(-1) : navigate("/", { replace: true }))}
              />
            </>
          ) : (
            <>
              <div className="card">
                <div className="stack">
                  <EventVenue event={event} showMap={maps.map} />
                  {/* The organizer's own words, the same way the player's sheet shows
              them. Absent is ordinary and renders as nothing at all. */}
                  {event.description !== null ? <p className="text-lines">{event.description}</p> : null}
                  {/* Facts and action on one row where there is room, exactly as the
              player's sheet does it — this is the same event seen from the
              other side of the table, and it should not be a different shape.
              The board's cards open this page now, not the public one, so this
              is where Edit has to be: otherwise an organizer could only reach it
              by typing the player's URL for their own event. */}
                  <div className="detail__act">
                    {facts}
                    {event.status === "cancelled" ? null : (
                      <button type="button" className="btn btn--block" onClick={() => setEditing(true)}>
                        Edit Event
                      </button>
                    )}
                  </div>
                </div>
                <p className="detail__host">Hosted by {event.organizerName}</p>
              </div>
            </>
          )}
        </div>

        <div className="doorlist__guests stack">
          <h2 className="card__title">Who's coming</h2>

          {list.length === 0 ? (
            <EmptyState
              title="No RSVPs yet"
              hint="The event is live on the board with every seat open; names land here as players RSVP."
            />
          ) : (
            <ul className="stack" aria-busy={attendees.isFetching}>
              {list.map((attendee) => (
                <li key={attendee.playerId} className="card">
                  <div className="card__row">
                    <span>{attendee.name}</span>
                    <span className="text-sm muted">
                      RSVP'd{" "}
                      <time dateTime={toDateTimeAttr(attendee.rsvpAt)}>{formatEventDateTime(attendee.rsvpAt)}</time>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  if (!asSheet) return <div className="stack stack--loose">{body}</div>;

  return (
    <Sheet label={`${event.title} — who's coming`} onClose={close}>
      {body}
    </Sheet>
  );
}
