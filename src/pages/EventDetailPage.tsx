/**
 * The deep-linkable version of a card: everything the card has, plus room to
 * breathe, and the same one-tap RSVP.
 *
 * `GET /api/events/:id` carries `myRsvp`, so this page needs no join. It also
 * carries `organizerId`, which is the one thing a display name cannot answer:
 * whether the organizer reading this is the one who posted it. If so, the
 * primary action is Edit — this is the page they arrive on from the board, and
 * it is the only place on the public side that can offer it.
 *
 * What used to sit there was "Switch to a player to RSVP", offered to anyone
 * signed in who could not take a seat. It solved a problem the header now
 * solves better: the switcher hangs off the name button on every page, so a
 * second copy of it here was a button spending the page's primary slot on
 * something the reader did not come for.
 *
 * **Two frames, one page.** Tapped from a card it renders as a sheet over the
 * dimmed board (`asSheet`); reached by a typed URL, a shared link or a refresh
 * it renders as the full page it has always been. `routes.tsx` decides which,
 * from the navigation's own state — everything below this line is identical in
 * both, so there is exactly one copy of the layout and one copy of the query.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useEvent, useMapsConfig, useMyRsvpIds } from "../api/hooks";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventDangerZone } from "../components/EventDangerZone";
import { EventForm } from "../components/EventForm";
import { EventFacts, EventSheetHeader, EventVenue } from "../components/EventSheet";
import { RsvpButton } from "../components/RsvpButton";
import { Sheet } from "../components/Sheet";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import { isPastEvent } from "../lib/datetime";

export function EventDetailPage({ asSheet = false }: { asSheet?: boolean }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { isPlayer, user } = useIdentity();
  const event = useEvent(id);
  const myRsvpIds = useMyRsvpIds();
  // The one public page that asks. The board deliberately does not: the flags
  // change nothing there, so a request per list would buy nothing.
  const maps = useMapsConfig({ enabled: true });
  const [editing, setEditing] = useState(false);

  // Closing is `navigate(-1)`, not a state flag: the sheet *is* a history entry,
  // so Back, the scrim and a downward drag have to mean the same thing or they
  // would disagree about where you end up.
  const close = () => void navigate(-1);

  if (event.isPending) {
    return (
      <div className="stack" role="status" aria-busy="true" aria-label="Loading event">
        <Skeleton width="80%" height={28} />
        <Skeleton width="60%" height={18} />
        <Skeleton height={120} />
      </div>
    );
  }

  if (event.isError) {
    return (
      <div className="stack">
        <ErrorBanner error={event.error} onRetry={() => void event.refetch()} />
        <Link to="/">Back to all events</Link>
      </div>
    );
  }

  const detail = event.data;
  const joined = detail.myRsvp ?? myRsvpIds.has(detail.id);
  const cancelled = detail.status === "cancelled";
  const past = isPastEvent(detail.startsAt);
  // Ownership comes from the row, never from a name: two organizers may share
  // one. The server checks it again on the PATCH — this only decides what to
  // draw.
  const mine = user?.role === "organizer" && user.id === detail.organizerId;

  // One action per reader, and for most states there is none: an organizer
  // looking at someone else's event, a cancelled one, a night that has already
  // happened (`RsvpButton` returns null for that itself).
  const action = isPlayer ? (
    <RsvpButton
      eventId={detail.id}
      title={detail.title}
      isFull={detail.isFull}
      joined={joined}
      startsAt={detail.startsAt}
      status={detail.status}
      block
    />
  ) : mine && !cancelled ? (
    <button type="button" className="btn btn--block" onClick={() => setEditing(true)}>
      Edit Event
    </button>
  ) : null;

  const body = (
    <>
      {asSheet ? null : (
        <Link to="/" className="text-sm">
          ← All events
        </Link>
      )}

      {/* The same header, facts and venue as the door list — one component
          each, in `EventSheet.tsx`, with the reasoning. */}
      <EventSheetHeader event={detail} />

      {mine && editing ? (
        <>
          {/* Same shape as the door list's edit mode — see `AttendeesPage` for
              why the facts stay and the read view goes. */}
          <EventFacts event={detail} attendeeCount={detail.attendeeCount} past={past} />
          <EventForm event={detail} onDone={() => setEditing(false)} />
          <EventDangerZone
            event={detail}
            onCancelled={() => setEditing(false)}
            onDeleted={() => void (asSheet ? navigate(-1) : navigate("/", { replace: true }))}
          />
        </>
      ) : (
        <div className="card">
          <div className="stack">
            <EventVenue event={detail} showMap={maps.map} />
            {/* The organizer's own words, and the reason this page is not just a
              bigger card. Absent is the ordinary case, and an absent paragraph
              renders as nothing at all — no heading left standing over it. */}
            {detail.description !== null ? <p className="text-lines">{detail.description}</p> : null}
            {/* The facts and the action share a row where there is room for one.
              They are the two halves of the same decision — "four seats left,
              twelve going" and the button that acts on it — and on a desktop a
              full-width button on its own line put the width of the panel
              between them. On a phone it is still a column: the button is a
              thumb target and takes the whole line. */}
            <div className="detail__act">
              <EventFacts event={detail} attendeeCount={detail.attendeeCount} past={past} joined={joined} />
              {action}
            </div>
            {cancelled ? (
              <p className="text-sm muted">
                This event was cancelled. {joined ? "Your seat is gone — you can clear it from your list." : ""}
              </p>
            ) : null}
          </div>
          <p className="detail__host">Hosted by {detail.organizerName}</p>
        </div>
      )}
    </>
  );

  if (!asSheet) return <div className="stack stack--loose">{body}</div>;

  return (
    <Sheet label={detail.title} onClose={close}>
      {body}
    </Sheet>
  );
}
