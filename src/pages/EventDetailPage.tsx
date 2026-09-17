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
import { gameTypeLabel } from "../../shared/game-types";
import { attendanceLabel } from "../lib/attendance";
import { isPastEvent } from "../lib/datetime";
import { mapsDirectionsUrl } from "../../shared/maps-links";
import { useEvent, useMapsConfig, useMyRsvpIds } from "../api/hooks";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { EventDangerZone } from "../components/EventDangerZone";
import { EventForm } from "../components/EventForm";
import { EventMiniMap } from "../components/EventMiniMap";
import { MapLink } from "../components/MapLink";
import { RsvpButton } from "../components/RsvpButton";
import { Sheet } from "../components/Sheet";
import { GoingChip, SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import { formatEventWhen, toDateTimeAttr } from "../lib/datetime";

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
  const close = () => navigate(-1);

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

  const body = (
    <>
      {asSheet ? null : (
        <Link to="/" className="text-sm">
          ← All events
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
        <span className="detail__kind">{gameTypeLabel(detail.gameType)}</span>
        <h1 className="page-title">{detail.title}</h1>
        <p className="detail__when">
          <time dateTime={toDateTimeAttr(detail.startsAt)}>{formatEventWhen(detail.startsAt)}</time>
        </p>
      </div>

      {mine && editing ? (
        <>
          {/* Same shape as the door list's edit mode — see `AttendeesPage` for
              why the facts stay and the read view goes. */}
          <div className="detail__facts">
            <SeatChip
              seatsLeft={detail.seatsLeft}
              capacity={detail.capacity}
              isFull={detail.isFull}
              status={detail.status}
              past={past}
            />
            <span className="badge badge--count">
              <Icon name="player" size={14} />
              {attendanceLabel(detail.attendeeCount, past)}
            </span>
          </div>
          <EventForm event={detail} onDone={() => setEditing(false)} />
          <EventDangerZone
            event={detail}
            onCancelled={() => setEditing(false)}
            onDeleted={() => (asSheet ? navigate(-1) : navigate("/", { replace: true }))}
          />
        </>
      ) : (
      <div className="card">
        <div className="stack">
          {/* The venue block: the label you can tap, the address Google
              confirmed (only when it adds something the label does not already
              say), the map, and the one button the phone user came for. */}
          <div className="venue">
            <MapLink event={detail} className="card__address venue__link" withAddress />
            {/* The map is itself a link to the same directions URL, so where
                there is a map the button underneath was a second copy of it.
                Where there is none — a free-text venue, or a deployment with no
                maps key — it is the only way to navigation, so it stays. The
                venue label above links to a Maps *search*, which is close but
                not the same thing, and not what someone standing outside with a
                phone wants. */}
            {detail.place !== null && maps.map ? (
              <EventMiniMap eventId={detail.id} place={detail.place} location={detail.location} />
            ) : (
              <a
                className="btn btn--secondary venue__directions"
                href={mapsDirectionsUrl(detail)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions
                <span className="visually-hidden"> — opens in Google Maps</span>
              </a>
            )}
          </div>
          {/* The organizer's own words, and the reason this page is not just a
              bigger card. Absent is the ordinary case, and an absent paragraph
              renders as nothing at all — no heading left standing over it. */}
          {detail.description !== null ? <p className="text-lines">{detail.description}</p> : null}
          {/* Three separate facts, because they are three: whether you have a
              seat, whether the table has any, and how many people that is. They
              used to be two, with the first two crammed into one pill. */}
          <div className="detail__facts">
            {joined && !past && !cancelled ? <GoingChip /> : null}
            <SeatChip
              seatsLeft={detail.seatsLeft}
              capacity={detail.capacity}
              isFull={detail.isFull}
              status={detail.status}
              past={past}
            />
            <span className="badge badge--count">
              <Icon name="player" size={14} />
              {attendanceLabel(detail.attendeeCount, past)}
            </span>
          </div>
          {cancelled ? (
            <p className="text-sm muted">
              This event was cancelled. {joined ? "Your seat is gone — you can clear it from your list." : ""}
            </p>
          ) : null}
        </div>
        {isPlayer ? (
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
        ) : null}
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
