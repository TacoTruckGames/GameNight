/**
 * The organizer side: post a table, then see who's coming.
 *
 * The form itself is `EventForm`, which the event page also wears to edit one —
 * posting and editing ask for the same seven things, so they are one component
 * with two submit paths rather than two forms waiting to drift apart.
 */

import { useMemo, useState } from "react";
import { useHostedEvents } from "../api/hooks";
import { AgendaViewSwitch, DEFAULT_AGENDA_VIEW, type AgendaView } from "../components/AgendaViewSwitch";
import { DayGroupedList } from "../components/DayGroupedList";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventForm } from "../components/EventForm";
import { HostedEventCard } from "../components/HostedEventCard";
import { EventListSkeleton } from "../components/Skeleton";
import { WeekAgenda, weekWindow } from "../components/WeekAgenda";
import { dayKey, groupByDay, shiftDays, startOfWeek, type DayKey } from "../lib/calendar";

function HostedEvents() {
  const [view, setView] = useState<AgendaView>(DEFAULT_AGENDA_VIEW);
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(dayKey(new Date())!));

  // Week view asks for exactly the seven days on screen; list view asks for
  // nothing and keeps the endpoint's upcoming-only default.
  const window = useMemo(() => (view === "week" ? weekWindow(weekStart) : undefined), [view, weekStart]);
  const hosted = useHostedEvents(window);

  // Same day headings as the board and My RSVP; `data` is a stable reference
  // between renders, so the memo actually holds.
  const events = hosted.data;
  const groups = useMemo(() => groupByDay(events ?? []), [events]);

  const thisWeek = startOfWeek(dayKey(new Date())!);
  const showWeek = (next: DayKey) => setWeekStart(next);

  // No second unwindowed query to tell an empty week from an empty account: a
  // window cannot know more than the window, and the "never posted" copy is one
  // tap away in list view.
  const emptyWeek = (
    <EmptyState
      title={weekStart === thisWeek ? "Nothing scheduled this week" : "Nothing scheduled that week"}
      hint="Post an event above."
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
        </>
      }
    />
  );

  // A fragment, not a wrapper: the switch and the list are siblings of the
  // "Your events" heading inside the section's own `.stack`, which already
  // spaces them.
  return (
    <>
      <AgendaViewSwitch value={view} onChange={setView} />
      {/* List-only placeholder check — it stops a windowed week's rows leaking
          into the unwindowed list for one fetch. */}
      {hosted.isPending || (view === "list" && hosted.isPlaceholderData) ? (
        <EventListSkeleton label="Loading your events" />
      ) : hosted.isError ? (
        <ErrorBanner error={hosted.error} onRetry={() => void hosted.refetch()} />
      ) : view === "list" && (hosted.data?.length ?? 0) === 0 ? (
        <EmptyState title="You haven't posted an event yet" hint="Use the form above to put a table on the board." />
      ) : view === "week" ? (
        <WeekAgenda
          events={events ?? []}
          weekStart={weekStart}
          onWeekChange={showWeek}
          busy={hosted.isFetching}
          loading={hosted.isPlaceholderData}
          emptyWeek={emptyWeek}
        >
          {(event) => <HostedEventCard event={event} />}
        </WeekAgenda>
      ) : (
        <DayGroupedList groups={groups} busy={hosted.isFetching}>
          {(event) => <HostedEventCard event={event} />}
        </DayGroupedList>
      )}
    </>
  );
}

export function OrganizerPage() {
  return (
    <div className="stack stack--loose">
      <div>
        <h1 className="page-title">Organize</h1>
        <p className="page-subtitle">Post a table and keep an eye on the door list.</p>
      </div>
      <EventForm />
      <div className="stack">
        <h2 className="card__title">Your events</h2>
        <HostedEvents />
      </div>
    </div>
  );
}
