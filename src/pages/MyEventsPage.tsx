/**
 * "What am I doing this week?" — the player's own list, soonest first, with
 * cancel on each card.
 */

import { Link } from "react-router";
import { useMyRsvps } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { EventListSkeleton } from "../components/Skeleton";

export function MyEventsPage() {
  const myEvents = useMyRsvps();

  return (
    <>
      <h1 className="page-title">My events</h1>
      <p className="page-subtitle">Seats you're holding, soonest first.</p>

      {myEvents.isPending ? (
        <EventListSkeleton label="Loading your events" />
      ) : myEvents.isError ? (
        <ErrorBanner error={myEvents.error} onRetry={() => void myEvents.refetch()} />
      ) : (myEvents.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="You haven't RSVP'd to anything yet"
          hint="Browse the board and grab a seat."
          action={
            <Link className="btn btn--sm btn--secondary" to="/">
              Find an event
            </Link>
          }
        />
      ) : (
        <ul className="stack" aria-busy={myEvents.isFetching}>
          {myEvents.data?.map((event) => (
            <li key={event.id}>
              <EventCard event={event} joined showRsvp />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
