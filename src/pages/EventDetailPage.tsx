/**
 * The deep-linkable version of a card: everything the card has, plus room to
 * breathe, and the same one-tap RSVP.
 *
 * `GET /api/events/:id` carries `myRsvp`, so this page needs no join.
 */

import { Link, useParams } from "react-router";
import { gameTypeLabel } from "../../shared/game-types";
import { useEvent, useMyRsvpIds } from "../api/hooks";
import { ErrorBanner } from "../components/ErrorBanner";
import { RsvpButton } from "../components/RsvpButton";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import { formatEventDateTimeLong, toDateTimeAttr } from "../lib/datetime";

export function EventDetailPage() {
  const { id = "" } = useParams();
  const { isPlayer } = useIdentity();
  const event = useEvent(id);
  const myRsvpIds = useMyRsvpIds();

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
          <p className="muted">{detail.location}</p>
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
          <p className="text-sm muted">Sign in as a player to RSVP.</p>
        )}
      </div>
    </div>
  );
}
