/**
 * "What am I doing this week?" — the player's own list, soonest first, with
 * cancel on each card.
 *
 * Day-grouped by the same component the board uses. The question this page
 * answers is a calendar question — am I double-booked on Saturday? — which a
 * flat list makes you work out by reading every date in turn.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { useMyRsvps } from "../api/hooks";
import { AgendaList } from "../components/AgendaList";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventListSkeleton } from "../components/Skeleton";
import { groupByDay } from "../lib/calendar";

export function MyEventsPage() {
  const myEvents = useMyRsvps();
  // Memoised on the query's own `data` reference, which is stable between
  // renders — `?? []` inline would be a new array every time and defeat both.
  const events = myEvents.data;
  const groups = useMemo(() => groupByDay(events ?? []), [events]);
  // Every event on this page is one the player holds a seat on — that is what
  // the endpoint returns — so the card's "You're in" state is not a lookup.
  const joinedIds = useMemo(() => new Set((events ?? []).map((event) => event.id)), [events]);

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
        <AgendaList groups={groups} myRsvpIds={joinedIds} showRsvp busy={myEvents.isFetching} />
      )}
    </>
  );
}
