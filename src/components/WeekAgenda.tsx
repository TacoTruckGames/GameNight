/**
 * The week shell both personal agendas wear: a strip of seven days, and the
 * one day you picked, underneath.
 *
 * It owns no data. My RSVP and the organizer's list fetch their own rows for
 * their own window and hand them in, with the card as a render prop — same
 * division of labour as `DayGroupedList`, which this reuses for the pane, so
 * the day heading below the strip is the same heading the list view writes.
 * Deliberately not "Today": the board's pane and this one should never disagree
 * about what a day is called.
 *
 * Nothing is picked to begin with, and the pane shows the whole week — minus
 * whatever has already started. A day cell is a filter you apply, and pressing
 * the open one takes it off again, so `aria-pressed` means what it says in both
 * directions and the overview is always one press away. The strip never decides
 * for you which day you came to look at.
 *
 * The container is a plain `.stack.stack--loose` plus a `week-agenda` hook a
 * wide page can use to set the strip beside the day's cards, not the board's
 * `.board-calendar`: that rule exists to widen a month grid past the reading
 * column, and a one-row strip already fits.
 */

import { useMemo, useState, type ReactNode } from "react";
import { DayGroupedList } from "./DayGroupedList";
import { EmptyState } from "./EmptyState";
import { EventListSkeleton } from "./Skeleton";
import { WeekStrip } from "./WeekStrip";
import { dayKey, groupByDay, parseDayKey, shiftDays, type DayKey } from "../lib/calendar";
import { upcomingGroups } from "../lib/datetime";

/**
 * The half-open `?from=&to=` window for a week, as instants.
 *
 * This is the board's month window with a different length, and it is here
 * rather than in `calendar.ts` for the reason that file's header gives: the two
 * ends are computed in **local** time and handed over as UTC, because the strip
 * buckets events by the reader's civil day — a UTC-midnight window would push a
 * late-evening event onto the wrong side of the boundary. That makes it a
 * zone-aware operation on a `Date` constructor, untestable in a runtime pinned
 * to UTC, while `calendar.ts` is DOM-free civil arithmetic that answers the same
 * everywhere. So it lives next to its callers instead.
 *
 * `new Date(y, m - 1, d + 7)` rolls the month and the year on its own, exactly
 * as the board's `new Date(y, 12, 1)` does, so the last week of December and
 * the last week of any month need no special case.
 */
export function weekWindow(weekStart: DayKey): { from: string; to: string } {
  const { year, month, day } = parseDayKey(weekStart);
  return {
    from: new Date(year, month - 1, day).toISOString(),
    to: new Date(year, month - 1, day + 7).toISOString(),
  };
}

export function WeekAgenda<T extends { id: string; startsAt: string }>({
  events,
  weekStart,
  onWeekChange,
  busy,
  loading,
  emptyWeek,
  children,
}: {
  events: readonly T[];
  weekStart: DayKey;
  onWeekChange: (nextStart: DayKey) => void;
  /** A refetch is in flight; the rows on screen are still the right ones. */
  busy?: boolean;
  /**
   * The rows on screen belong to a *different* week — the query is showing its
   * placeholder while the new week loads. Without this the pane would flash the
   * empty state on every week change, because last week's rows all fall outside
   * the new week and the strip goes to zero counts before the fetch lands.
   */
  loading?: boolean;
  emptyWeek: ReactNode;
  /** Renders one event's card. Called once per event in the open day, in order. */
  children: (event: T) => ReactNode;
}) {
  // The only state is the tap, and it carries the week it was made in. Any week
  // change therefore retires it automatically, with no effect and no wrapper
  // around `onWeekChange`: the board needs `showMonth` to clear its selection by
  // hand, and this is that guarantee expressed as data instead.
  // The only state is the tap, and it carries the week it was made in. Any week
  // change therefore retires it automatically, with no effect and no wrapper
  // around `onWeekChange`: the board needs `showMonth` to clear its selection by
  // hand, and this is that guarantee expressed as data instead.
  const [tap, setTap] = useState<{ week: DayKey; day: DayKey } | null>(null);

  const todayKey = dayKey(new Date())!; // `new Date()` is always valid; per render is fine
  // The end is `start + 7`, never `weekDays(start)[6]`: the exclusive bound is
  // what "in this week" is actually asking, and it needs no index to exist.
  const weekEnd = shiftDays(weekStart, 7);
  const inWeek = (key: DayKey) => key >= weekStart && key < weekEnd;

  const groups = useMemo(() => groupByDay(events), [events]);
  const counts = useMemo(() => new Map(groups.map((group) => [group.key, group.events.length])), [groups]);

  // Derived, never synced into state by an effect: this week's tap if that day
  // still has events, and otherwise nothing at all. No today fallback and no
  // first-day-with-events fallback — opening on a day nobody asked for hides the
  // rest of the week behind a choice the reader did not make, and on any week
  // behind today it opened on something already finished.
  const pick = (key: DayKey | null) => (key !== null && counts.has(key) && inWeek(key) ? key : null);
  const effectiveDay = pick(tap?.week === weekStart ? tap.day : null);
  const selectedGroup = groups.find((group) => group.key === effectiveDay) ?? null;

  // With no day open — the state you arrive in — the pane shows the week itself,
  // upcoming only. `inWeek` matters because a placeholder render is still
  // holding the *previous* week's rows, and none of them belong here.
  const thisWeeksGroups = useMemo(
    () => groups.filter((group) => group.key >= weekStart && group.key < shiftDays(weekStart, 7)),
    [groups, weekStart],
  );
  const wholeWeek = useMemo(() => upcomingGroups(thisWeeksGroups), [thisWeeksGroups]);

  return (
    <div className="stack stack--loose week-agenda">
      <WeekStrip
        weekStart={weekStart}
        todayKey={todayKey}
        counts={counts}
        selectedDay={effectiveDay}
        onSelectDay={(key) => setTap(key === effectiveDay ? null : { week: weekStart, day: key })}
        onWeekChange={onWeekChange}
      />
      {selectedGroup ? (
        <DayGroupedList groups={[selectedGroup]} busy={busy}>
          {children}
        </DayGroupedList>
      ) : loading ? (
        <EventListSkeleton count={1} label="Loading this week" />
      ) : wholeWeek.length > 0 ? (
        <DayGroupedList groups={wholeWeek} busy={busy}>
          {children}
        </DayGroupedList>
      ) : thisWeeksGroups.length > 0 ? (
        // The week is not empty, it is *over* — page back far enough, or arrive
        // late on a Sunday, and every row here has already started. Saying "no
        // events" would be a lie the counts on the strip immediately contradict,
        // so say what is true and point at the cells that still open.
        <EmptyState title="Nothing upcoming" hint="Pick a day above to see what happened." />
      ) : (
        emptyWeek
      )}
    </div>
  );
}
