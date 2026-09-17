/**
 * The board. Search + game-type filter, then cards in one of three shapes.
 *
 * **Whose board it is depends on who is reading.** A player sees everybody's
 * events, from the cacheable public endpoint. An organizer sees their own, from
 * `/api/me/hosted`, with cards that link to the door list instead of offering a
 * seat — because an organizer's question about a board is "who is coming to my
 * tables", and they had been answering it on a second page that carried a
 * duplicate of this one underneath a form.
 *
 * Both hooks are called on every render, as hooks must be, and each is disabled
 * for the role it does not serve, so exactly one request goes out. The three
 * views below are the same three either way — one hook, one endpoint per role,
 * no second data source, just a different question asked of it:
 *
 * - **Week** (the default): the seven days on screen, `?from=&to=`.
 * - **Month**: the month on screen, same window a month wide.
 * - **List**: no window at all, so it stays upcoming-only — its job is still
 *   "find a table you can still join".
 *
 * All three are soonest-first. The board briefly offered a Sort control beside
 * the View switch; one row of filters carrying search, game type, view *and*
 * order was more chrome than a board this size earns, and the clock is the
 * order a listings page is read in anyway. `?sort=` still exists on the API.
 *
 * Both dated views send a window because a grid with nothing behind today is a
 * grid you cannot page backwards through. Their two ends are computed in
 * **local** time and handed over as UTC: the cells bucket events by the
 * reader's civil day, and a UTC-midnight window would push a late-evening event
 * onto the wrong side of the boundary.
 *
 * `GET /api/events` is deliberately user-independent (so it stays cacheable),
 * so the joined state comes from `GET /api/me/rsvps` and is joined here on the
 * client.
 */

import { useEffect, useId, useMemo, useState } from "react";
import type { EventSummary } from "../../shared/api-types";
import { SEARCH_MAX } from "../../shared/schemas";
import { useEvents, useHostedEvents, useMyRsvpIds } from "../api/hooks";
import { AgendaList } from "../components/AgendaList";
import { DayGroupedList } from "../components/DayGroupedList";
import { BoardViewSwitch, DEFAULT_BOARD_VIEW, type BoardView } from "../components/BoardViewSwitch";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { HostedEventCard } from "../components/HostedEventCard";
import { Icon } from "../components/Icon";
import { GameTypeFilter } from "../components/GameTypeFilter";
import { MonthCalendar } from "../components/MonthCalendar";
import { WeekAgenda, weekWindow } from "../components/WeekAgenda";
import { EventListSkeleton } from "../components/Skeleton";
import { Link } from "react-router";
import { useIdentity } from "../identity/IdentityContext";
import { upcomingGroups } from "../lib/datetime";
import { PHONE_QUERY, useMediaQuery } from "../lib/media";
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
  const { isPlayer, isOrganizer } = useIdentity();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gameType, setGameType] = useState("");
  const [view, setView] = useState<BoardView>(DEFAULT_BOARD_VIEW);
  // Sharing its line with the type picker leaves the search box about 200px on a
  // phone, where the long placeholder is cut off mid-word — which tells the
  // reader less than the short one does. The label the screen reader hears is
  // the full sentence either way.
  const phone = useMediaQuery(PHONE_QUERY);
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(dayKey(new Date())!));
  const [month, setMonth] = useState<YearMonth>(() => monthOf(dayKey(new Date())!));
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(null); // the user's explicit tap only
  const searchId = useId();

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

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
    return undefined;
  }, [view, weekStart, month]);

  // Two boards, one page. A player's is everybody's events, from the cacheable
  // public endpoint; an organizer's is their own, from `/api/me/hosted` — the
  // same list `/organize` used to carry underneath its form, which meant an
  // organizer had two places to look at their own week. Both hooks are called
  // every render because hooks must be, and each is switched off for the role
  // it does not serve, so exactly one request goes out.
  const publicEvents = useEvents({ q: debouncedSearch, gameType, ...(window ?? {}) }, { enabled: !isOrganizer });
  const hostedEvents = useHostedEvents(window);
  const events = isOrganizer ? hostedEvents : publicEvents;
  const myRsvpIds = useMyRsvpIds();
  const filtered = debouncedSearch !== "" || gameType !== "";

  // `/api/me/hosted` takes a window and nothing else — no `q`, no `gameType` —
  // so for an organizer the two filters are applied here. That is affordable
  // precisely because the endpoint is already capped at 200 rows: this is a
  // filter over one organizer's own events, not over a database.
  const rows: EventSummary[] = useMemo(() => {
    const all = events.data ?? [];
    if (!isOrganizer) return all;
    const needle = debouncedSearch.toLowerCase();
    return all.filter(
      (event) =>
        (gameType === "" || event.gameType === gameType) &&
        (needle === "" ||
          event.title.toLowerCase().includes(needle) ||
          event.location.toLowerCase().includes(needle)),
    );
  }, [events.data, isOrganizer, debouncedSearch, gameType]);

  const todayKey = dayKey(new Date())!; // `new Date()` is always valid; per render is fine
  const thisWeek = startOfWeek(todayKey);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const counts = useMemo(() => new Map(groups.map((group) => [group.key, group.events.length])), [groups]);

  // Derived, never synced into state by an effect: the tap if that day still has
  // events in the month on screen, and otherwise nothing at all. Same rule as
  // the week strip, and for the same reason — a grid that opens itself on a day
  // hides the rest of the month behind a choice the reader did not make, and on
  // any month behind today it opened on something already finished.
  const pick = (key: DayKey | null) => (key !== null && counts.has(key) && sameMonth(monthOf(key), month) ? key : null);
  const effectiveDay = pick(selectedDay);
  const selectedGroup = groups.find((group) => group.key === effectiveDay) ?? null;

  // With no day open — the state you arrive in — the pane shows the month
  // itself, upcoming only. The month filter matters because a placeholder render
  // still holds the *previous* month's rows, and none belong on this grid.
  const thisMonthsGroups = useMemo(
    () => groups.filter((group) => sameMonth(monthOf(group.key), month)),
    [groups, month],
  );
  const wholeMonth = useMemo(() => upcomingGroups(thisMonthsGroups), [thisMonthsGroups]);

  // Both of these are reached from two places now (the calendar's own controls
  // and the empty states below), so they live here rather than being retyped —
  // changing month always drops the explicit tap, which belonged to the month
  // you just left.
  const showMonth = (next: YearMonth) => {
    setMonth(next);
    setSelectedDay(null);
  };
  // One card per role. The organizer's links to the door list and counts seats;
  // the player's links to the event and offers the seat.
  const card = (event: EventSummary) =>
    isOrganizer ? (
      <HostedEventCard event={event} />
    ) : (
      <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={isPlayer} />
    );
  // The day you have open is the day you would be adding to. Offered only to an
  // organizer, and only for a day that has not already happened — a "+ New
  // Event" on last Tuesday is a button whose only outcome is a validation error.
  const newEventOn = (day: DayKey) =>
    isOrganizer && day >= todayKey ? (
      <Link className="btn btn--sm btn--secondary new-event" to={`/organize?date=${day}`}>
        + New Event
      </Link>
    ) : null;

  const agenda = (dayGroups: typeof groups, busy?: boolean) =>
    isOrganizer ? (
      <DayGroupedList groups={dayGroups} busy={busy}>
        {card}
      </DayGroupedList>
    ) : (
      <AgendaList groups={dayGroups} myRsvpIds={myRsvpIds} showRsvp={isPlayer} busy={busy} />
    );

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
      <h1 className="page-title">{isOrganizer ? "Our Upcoming Events" : "Upcoming Events"}</h1>

      <div className="filters">
        <div className="filters__row">
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
              placeholder={phone ? "Search event" : "Search event title or location"}
              maxLength={SEARCH_MAX}
              autoComplete="off"
            />
          </div>
          <GameTypeFilter value={gameType} onChange={setGameType} />
        </div>
        <BoardViewSwitch value={view} onChange={setView} />
      </div>

      {/* The placeholder check is list-only. Switching away from a dated view
          leaves that window's rows on screen for one fetch, and in the list they
          are wrong twice over: too few, and some of them already started — which
          is the one thing this view promises never to show. In the dated views
          the stale rows are the better thing to keep: the grid holds its shape
          and the strip never flashes empty. */}
      {events.isPending || (view === "list" && events.isPlaceholderData) ? (
        <EventListSkeleton />
      ) : events.isError ? (
        <ErrorBanner error={events.error} onRetry={() => void events.refetch()} />
      ) : view === "list" && rows.length === 0 ? (
        // List view only: an empty week or month is an ordinary thing to page
        // through, so those views keep their controls on screen and say so in
        // their own empty states rather than replacing themselves with this one.
        <EmptyState
          title={filtered ? "No upcoming events match" : isOrganizer ? "You haven't posted anything yet" : "No upcoming events yet"}
          hint={
            filtered
              ? "Try a different search or clear the filters."
              : isOrganizer
                ? "Post one from the Organize tab and it will appear here."
                : "Check back soon — organizers post new tables regularly."
          }
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
          dayAction={newEventOn}
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
          {card}
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
            onSelectDay={(key) => setSelectedDay(key === effectiveDay ? null : key)}
            onMonthChange={showMonth}
          />
          {selectedGroup ? (
            <>
              {newEventOn(selectedGroup.key)}
              {agenda([selectedGroup], events.isFetching)}
            </>
          ) : events.isPlaceholderData ? (
            // Still last month's rows, and every one of them falls outside the
            // month now on screen — without this the pane would flash "no events"
            // on the way to every month that has some.
            <EventListSkeleton count={1} label="Loading this month" />
          ) : wholeMonth.length > 0 ? (
            agenda(wholeMonth, events.isFetching)
          ) : thisMonthsGroups.length > 0 ? (
            // The month is not empty, it is *over*: page back and every row on
            // the grid has already started. "No events in September" would be a
            // lie the numbered cells right above it contradict.
            <EmptyState title="Nothing upcoming" hint="Pick a day to see what happened." />
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
      ) : (
        agenda(groups, events.isFetching)
      )}
    </div>
  );
}
