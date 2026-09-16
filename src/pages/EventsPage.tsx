/**
 * The board. Search + game-type chips, then the same list of RSVP-able cards
 * in one of two shapes: **List** (day-grouped under the default `date` sort,
 * flat under `popular` — a rank has no day boundaries) or **Calendar**, a month
 * grid built from the same `useEvents` hook and the same endpoint — no second
 * data source — asked a different question: give me this month, `?from=&to=`,
 * past days included. A month grid with nothing behind today is a grid you
 * cannot page backwards through.
 *
 * List view sends no window on purpose, so it stays upcoming-only: its job is
 * still "find a table you can still join".
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
import { EventListSkeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import {
  dayKey,
  formatMonthLabel,
  groupByDay,
  monthOf,
  sameMonth,
  shiftMonth,
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
  const [month, setMonth] = useState<YearMonth>(() => monthOf(dayKey(new Date())!));
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(null); // the user's explicit tap only
  const searchId = useId();

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // The grid is chronological by construction, so calendar view always asks for
  // the default sort — which also shares the query cache with the default list.
  const effectiveSort = view === "calendar" ? DEFAULT_EVENT_SORT : sort;

  // Calendar view asks for exactly the month on screen; list view asks for
  // nothing and gets the upcoming board.
  //
  // The two ends are computed in **local** time and handed over as UTC, because
  // the grid buckets events by the reader's civil day: the month that starts at
  // local midnight on the 1st is the month whose cells this grid draws, and a
  // UTC-midnight window would push a late-evening event onto the wrong side of
  // the boundary. `new Date(y, 12, 1)` rolls into next January on its own, so
  // December needs no special case.
  const monthWindow = useMemo(
    () =>
      view === "calendar"
        ? {
            from: new Date(month.year, month.month - 1, 1).toISOString(),
            to: new Date(month.year, month.month, 1).toISOString(),
          }
        : {},
    [view, month],
  );
  const events = useEvents({ q: debouncedSearch, gameType, sort: effectiveSort, ...monthWindow });
  const myRsvpIds = useMyRsvpIds();
  const filtered = debouncedSearch !== "" || gameType !== "";

  const todayKey = dayKey(new Date())!; // `new Date()` is always valid; per render is fine
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

  // One page width per view: the calendar's month grid wants more than the
  // reading column, so on a wide screen the whole board widens with it rather
  // than the grid alone breaking out from under the heading and the filters.
  return (
    <div className={view === "calendar" ? "board board--wide" : "board"}>
      <h1 className="page-title">Upcoming events</h1>
      <p className="page-subtitle">Find a table near you and grab a seat.</p>

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
        // List view only: an empty *month* is an ordinary thing to navigate
        // through, so the calendar keeps its controls on screen and says so in
        // its own empty state below rather than replacing itself with this one.
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
      ) : view === "calendar" ? (
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
