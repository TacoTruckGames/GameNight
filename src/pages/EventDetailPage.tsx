/**
 * The deep-linkable version of a card: everything the card has, plus room to
 * breathe, and the same one-tap RSVP.
 *
 * `GET /api/events/:id` carries `myRsvp`, so this page needs no join.
 */

import { useState } from "react";
import { Link, useParams } from "react-router";
import { gameTypeLabel } from "../../shared/game-types";
import { mapsDirectionsUrl } from "../../shared/maps-links";
import { useEvent, useMapsConfig, useMyRsvpIds } from "../api/hooks";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventMiniMap } from "../components/EventMiniMap";
import { MapLink } from "../components/MapLink";
import { RsvpButton } from "../components/RsvpButton";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import { WhoAreYou } from "../identity/WhoAreYou";
import { formatEventDateTimeLong, toDateTimeAttr } from "../lib/datetime";

export function EventDetailPage() {
  const { id = "" } = useParams();
  const { isPlayer } = useIdentity();
  const event = useEvent(id);
  const myRsvpIds = useMyRsvpIds();
  // The one public page that asks. The board deliberately does not: the flags
  // change nothing there, so a request per list would buy nothing.
  const maps = useMapsConfig({ enabled: true });
  // Same move as the header's "Switch": an organizer who wants this seat does
  // not have to go hunting for that button, the picker opens right here.
  const [switching, setSwitching] = useState(false);

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

  return (
    <div className="stack stack--loose">
      <Link to="/" className="text-sm">
        ← All events
      </Link>

      <div className="stack">
        <h1 className="page-title">{detail.title}</h1>
        <p className="card__meta">
          <span className="badge">{gameTypeLabel(detail.gameType)}</span> Hosted by {detail.organizerName}
        </p>
      </div>

      <div className="card">
        <div className="stack">
          <p>
            <time dateTime={toDateTimeAttr(detail.startsAt)}>{formatEventDateTimeLong(detail.startsAt)}</time>
          </p>
          {/* The venue block: the label you can tap, the address Google
              confirmed (only when it adds something the label does not already
              say), the map, and the one button the phone user came for. */}
          <div className="venue">
            <MapLink event={detail} className="card__address venue__link" />
            {detail.place && detail.place.address !== detail.location ? (
              <p className="text-sm muted venue__address">{detail.place.address}</p>
            ) : null}
            {detail.place && maps.map ? (
              <EventMiniMap eventId={detail.id} place={detail.place} location={detail.location} />
            ) : null}
            <a
              className="btn btn--secondary venue__directions"
              href={mapsDirectionsUrl(detail)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directions
              <span className="visually-hidden"> — opens in Google Maps</span>
            </a>
          </div>
          <div>
            <SeatChip
              seatsLeft={detail.seatsLeft}
              capacity={detail.capacity}
              isFull={detail.isFull}
              joined={joined}
              status={detail.status}
            />
          </div>
          {cancelled ? (
            <p className="text-sm muted">
              An admin cancelled this event. {joined ? "Your seat is gone — you can clear it from your list." : ""}
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
        ) : cancelled ? null : (
          // Not a disclaimer in the primary slot: you *are* signed in, just not
          // as someone who can take a seat, and this is the button that fixes
          // that without leaving the page.
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setSwitching(true)}>
            Switch to a player to RSVP
          </button>
        )}
      </div>

      {switching ? <WhoAreYou onClose={() => setSwitching(false)} /> : null}
    </div>
  );
}
