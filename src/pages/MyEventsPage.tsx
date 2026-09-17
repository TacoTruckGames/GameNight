/**
 * "What am I doing this week?" — the player's own seats, in one of two shapes.
 *
 * **Week** (the default) is a strip of the seven days on screen plus the cards
 * for the day you tapped: the question a personal agenda is opened with is a
 * calendar question — am I double-booked on Saturday? — which a flat list makes
 * you work out by reading every date in turn. It asks `/api/me/rsvps` the same
 * windowed question the board's calendar asks `/api/events`, so paging back a
 * week shows what you actually went to, greyed as past cards.
 *
 * **List** is the unwindowed, upcoming-only agenda, unchanged, one tap away.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMyRsvps } from "../api/hooks";
import { AgendaList } from "../components/AgendaList";
import { AgendaViewSwitch, DEFAULT_AGENDA_VIEW, type AgendaView } from "../components/AgendaViewSwitch";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { EventListSkeleton } from "../components/Skeleton";
import { WeekAgenda, weekWindow } from "../components/WeekAgenda";
import { dayKey, groupByDay, shiftDays, startOfWeek, type DayKey } from "../lib/calendar";

export function MyEventsPage() {
  const [view, setView] = useState<AgendaView>(DEFAULT_AGENDA_VIEW);
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(dayKey(new Date())!));

  // Week view asks for exactly the seven days on screen; list view asks for
  // nothing and gets the upcoming seats. Both ends are local and handed over as
  // UTC — see `weekWindow`.
  const window = useMemo(() => (view === "week" ? weekWindow(weekStart) : undefined), [view, weekStart]);
  const myEvents = useMyRsvps(window);

  // Memoised on the query's own `data` reference, which is stable between
  // renders — `?? []` inline would be a new array every time and defeat both.
  const events = myEvents.data;
  const groups = useMemo(() => groupByDay(events ?? []), [events]);
  // Every event on this page is one the player holds a seat on — that is what
  // the endpoint returns — so the card's "You're in" state is not a lookup.
  const joinedIds = useMemo(() => new Set((events ?? []).map((event) => event.id)), [events]);

  const thisWeek = startOfWeek(dayKey(new Date())!);
  const showWeek = (next: DayKey) => setWeekStart(next);

  // Deliberately no second, unwindowed query to tell "nothing this week" from
  // "you have never RSVP'd": that is a request on every visit to change one
  // sentence. The week copy is never false — a window cannot know more than the
  // window — and the "never" copy survives one tap away in list view.
  const emptyWeek = (
    <EmptyState
      title={weekStart === thisWeek ? "Nothing this week" : "Nothing that week"}
      hint="Browse the board and grab a seat."
      action={
        <>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => showWeek(shiftDays(weekStart, -7))}
          >
            Previous week
          </button>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => showWeek(shiftDays(weekStart, 7))}
          >
            Next week
          </button>
          <Link className="btn btn--sm btn--secondary" to="/">
            Find an event
          </Link>
        </>
      }
    />
  );

  return (
    <>
      <h1 className="page-title">My events</h1>
      <p className="page-subtitle">Seats you're holding, by day.</p>

      <div className="filters">
        <AgendaViewSwitch value={view} onChange={setView} />
      </div>

      {/* The placeholder check is list-only: it stops a windowed week's rows
          leaking into the unwindowed list for one fetch. In week view the stale
          week is the better thing to show — the pane keeps its shape and the
          strip never flashes empty. */}
      {myEvents.isPending || (view === "list" && myEvents.isPlaceholderData) ? (
        <EventListSkeleton label="Loading your events" />
      ) : myEvents.isError ? (
        <ErrorBanner error={myEvents.error} onRetry={() => void myEvents.refetch()} />
      ) : view === "list" && (myEvents.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="You haven't RSVP'd to anything yet"
          hint="Browse the board and grab a seat."
          action={
            <Link className="btn btn--sm btn--secondary" to="/">
              Find an event
            </Link>
          }
        />
      ) : view === "week" ? (
        <WeekAgenda
          events={events ?? []}
          weekStart={weekStart}
          onWeekChange={showWeek}
          busy={myEvents.isFetching}
          loading={myEvents.isPlaceholderData}
          emptyWeek={emptyWeek}
        >
          {(event) => <EventCard event={event} joined={joinedIds.has(event.id)} showRsvp />}
        </WeekAgenda>
      ) : (
        <AgendaList groups={groups} myRsvpIds={joinedIds} showRsvp busy={myEvents.isFetching} />
      )}
    </>
  );
}
