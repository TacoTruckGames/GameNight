/**
 * The board. Search + game-type filter, then the same RSVP-able cards in one of
 * three shapes, all from one `useEvents` hook and one endpoint — no second data
 * source, just a different question asked of it:
 *
 * - **Week** (the default): the seven days on screen, `?from=&to=`.
 * - **Month**: the month on screen, same window a month wide.
 * - **List**: no window at all, so it stays upcoming-only — its job is still
 *   "find a table you can still join" — and it is the only view that sorts by
 *   anything but the clock.
 *
 * Both dated views send a window because a grid with nothing behind today is a
 * grid you cannot page backwards through. Their two ends are computed in
 * **local** time and handed over as UTC: the cells bucket events by the
 * reader's civil day, and a UTC-midnight window would push a late-evening event
 * onto the wrong side of the boundary.
 *
 * `GET /api/events` is deliberately user-independent (so it stays cacheable),
 * so "You're in" comes from `GET /api/me/rsvps` and is joined here on the
 * client.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { DEFAULT_EVENT_SORT, type EventSort } from "../../shared/event-sort";
import { SEARCH_MAX } from "../../shared/schemas";
import { useEvents, useMyRsvpIds } from "../api/hooks";
import { AgendaList } from "../components/AgendaList";
import { BoardViewSwitch, DEFAULT_BOARD_VIEW, type BoardView } from "../components/BoardViewSwitch";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { EventSortControl } from "../components/EventSort";
import { Icon } from "../components/Icon";
import { GameTypeFilter } from "../components/GameTypeFilter";
import { MonthCalendar } from "../components/MonthCalendar";
import { WeekAgenda, weekWindow } from "../components/WeekAgenda";
import { EventListSkeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import {
  dayKey,
  formatMonthLabel,
  groupByDay,
  monthOf,
  sameMonth,
  shiftDays,
  shiftMonth,
  startOfWeek,
  type DayKey,
  type YearMonth,
} from "../lib/calendar";

const DEBOUNCE_MS = 250;

export function EventsPage() {
  const { isPlayer } = useIdentity();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gameType, setGameType] = useState("");
  const [sort, setSort] = useState<EventSort>(DEFAULT_EVENT_SORT);
  const [view, setView] = useState<BoardView>(DEFAULT_BOARD_VIEW);
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(dayKey(new Date())!));
  const [month, setMonth] = useState<YearMonth>(() => monthOf(dayKey(new Date())!));
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(null); // the user's explicit tap only
  const searchId = useId();

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A grid is chronological by construction, so only list view has an order to
  // choose — and asking for the default elsewhere shares the query cache with it.
  const effectiveSort = view === "list" ? sort : DEFAULT_EVENT_SORT;

  // One window per dated view; list asks for none and gets the upcoming board.
  // `new Date(y, 12, 1)` and `day + 7` both roll into the next month or year on
  // their own, so neither end needs a special case.
  const window = useMemo(() => {
    if (view === "week") return weekWindow(weekStart);
    if (view === "month")
      return {
        from: new Date(month.year, month.month - 1, 1).toISOString(),
        to: new Date(month.year, month.month, 1).toISOString(),
      };
    return {};
  }, [view, weekStart, month]);
  const events = useEvents({ q: debouncedSearch, gameType, sort: effectiveSort, ...window });
  const myRsvpIds = useMyRsvpIds();
  const filtered = debouncedSearch !== "" || gameType !== "";

  const todayKey = dayKey(new Date())!; // `new Date()` is always valid; per render is fine
  const thisWeek = startOfWeek(todayKey);
  const groups = useMemo(() => groupByDay(events.data ?? []), [events.data]);
  const counts = useMemo(() => new Map(groups.map((group) => [group.key, group.events.length])), [groups]);

  // Selection is derived with a fallback chain, never synced into state by an
  // effect: explicit tap if it still has events in the shown month → today →
  // first day with events in the shown month → nothing.
  const pick = (key: DayKey | null) => (key !== null && counts.has(key) && sameMonth(monthOf(key), month) ? key : null);
  const effectiveDay =
    pick(selectedDay) ?? pick(todayKey) ?? groups.find((group) => sameMonth(monthOf(group.key), month))?.key ?? null;
  const selectedGroup = groups.find((group) => group.key === effectiveDay) ?? null;

  // Both of these are reached from two places now (the calendar's own controls
  // and the empty states below), so they live here rather than being retyped —
  // changing month always drops the explicit tap, which belonged to the month
  // you just left.
  const showMonth = (next: YearMonth) => {
    setMonth(next);
    setSelectedDay(null);
  };
  const clearFilters = () => {
    setSearch("");
    setGameType("");
  };

  // The whole page widens on a wide screen, in every view — the heading, the
  // filters and the content then share one left and one right edge, which is
  // what widening only the grid got wrong the first time. What each view *does*
  // with the width differs, and that is the stylesheet's business.
  return (
    <div className="page--wide">
      <h1 className="page-title">Upcoming Events</h1>

      <div className="filters">
        <div className="search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search events by title or location
          </label>
          <span className="search__icon">
            <Icon name="search" />
          </span>
          <input
            id={searchId}
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or location"
            maxLength={SEARCH_MAX}
            autoComplete="off"
          />
        </div>
        <GameTypeFilter value={gameType} onChange={setGameType} />
        <BoardViewSwitch value={view} onChange={setView} />
        {view === "list" ? <EventSortControl value={sort} onChange={setSort} /> : null}
      </div>

      {events.isPending ? (
        <EventListSkeleton />
      ) : events.isError ? (
        <ErrorBanner error={events.error} onRetry={() => void events.refetch()} />
      ) : view === "list" && (events.data?.length ?? 0) === 0 ? (
        // List view only: an empty week or month is an ordinary thing to page
        // through, so those views keep their controls on screen and say so in
        // their own empty states rather than replacing themselves with this one.
        <EmptyState
          title={filtered ? "No upcoming events match" : "No upcoming events yet"}
          hint={filtered ? "Try a different search or clear the filters." : "Check back soon — organizers post new tables regularly."}
          action={
            filtered ? (
              <button type="button" className="btn btn--sm btn--secondary" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null
          }
        />
      ) : view === "week" ? (
        <WeekAgenda
          events={events.data ?? []}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          busy={events.isFetching}
          loading={events.isPlaceholderData}
          emptyWeek={
            <EmptyState
              title={weekStart === thisWeek ? "No events this week" : "No events that week"}
              hint={filtered ? "Try another week, or clear the filters." : "Try another week."}
              action={
                <>
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    onClick={() => setWeekStart(shiftDays(weekStart, -7))}
                  >
                    Previous week
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    onClick={() => setWeekStart(shiftDays(weekStart, 7))}
                  >
                    Next week
                  </button>
                  {filtered ? (
                    <button type="button" className="btn btn--sm btn--secondary" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : null}
                </>
              }
            />
          }
        >
          {(event) => <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={isPlayer} />}
        </WeekAgenda>
      ) : view === "month" ? (
        // `board-calendar` is the desktop hook only: wide enough, the grid and
        // the selected day's cards sit side by side instead of stacked.
        <div className="stack stack--loose board-calendar">
          <MonthCalendar
            month={month}
            todayKey={todayKey}
            counts={counts}
            selectedDay={effectiveDay}
            onSelectDay={setSelectedDay}
            onMonthChange={showMonth}
          />
          {selectedGroup ? (
            <AgendaList groups={[selectedGroup]} myRsvpIds={myRsvpIds} showRsvp={isPlayer} busy={events.isFetching} />
          ) : events.isPlaceholderData ? (
            // Still last month's rows, and every one of them falls outside the
            // month now on screen — without this the pane would flash "no events"
            // on the way to every month that has some.
            <EventListSkeleton count={1} label="Loading this month" />
          ) : (
            <EmptyState
              title={`No events in ${formatMonthLabel(month)}`}
              hint={filtered ? "Try another month, or clear the filters." : "Try another month."}
              action={
                <>
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    onClick={() => showMonth(shiftMonth(month, 1))}
                  >
                    Next month
                  </button>
                  {filtered ? (
                    <button type="button" className="btn btn--sm btn--secondary" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : null}
                </>
              }
            />
          )}
        </div>
      ) : sort === "date" ? (
        <AgendaList groups={groups} myRsvpIds={myRsvpIds} showRsvp={isPlayer} busy={events.isFetching} />
      ) : (
        <ul className="stack" aria-busy={events.isFetching}>
          {events.data?.map((event) => (
            <li key={event.id}>
              <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={isPlayer} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
