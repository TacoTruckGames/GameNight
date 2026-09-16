/**
 * Every event, not just the upcoming ones.
 *
 * The public board is `starts_at >= now AND status = 'scheduled'`; an operator
 * needs the other three quadrants too, so `when` and `status` are explicit
 * filters and both live in the URL.
 */

import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SEARCH_MAX } from "../../shared/schemas";
import { gameTypeLabel } from "../../shared/game-types";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { SeatChip } from "../components/SeatChip";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, toDateTimeAttr } from "../lib/datetime";
import { AdminPage } from "./AdminNav";
import { Pager } from "./Pager";
import { useAdminEvents } from "./hooks";

const DEBOUNCE_MS = 250;

const WHEN_FILTERS = [
  { value: "", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
] as const;

const STATUS_FILTERS = [
  { value: "", label: "Any status" },
  { value: "scheduled", label: "Scheduled" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function AdminEventsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  // The API defaults `when` to `upcoming`, so an absent value and "upcoming"
  // are the same filter — the chip row treats them as one.
  const when = params.get("when") === "upcoming" ? "" : (params.get("when") ?? "");
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const searchId = useId();

  const [search, setSearch] = useState(q);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useAdminEvents({ q, when, status, page });

  return (
    <AdminPage title="Events" subtitle="Fix a wrong time, raise a capacity, cancel a table.">
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

        <div className="chip-row" role="group" aria-label="Filter by date">
          {WHEN_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className="chip"
              aria-pressed={when === filter.value}
              onClick={() => update({ when: filter.value })}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="chip-row" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className="chip"
              aria-pressed={status === filter.value}
              onClick={() => update({ status: filter.value })}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {events.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading events">
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : events.isError ? (
        <ErrorBanner error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.items.length === 0 ? (
        <EmptyState title="No events match" hint="Try a different search or clear the filters." />
      ) : (
        <>
          <ul className="stack" aria-busy={events.isFetching}>
            {events.data.items.map((event) => (
              <li key={event.id}>
                <article className="card">
                  <Link className="card__link" to={`/admin/events/${event.id}`}>
                    <span className="card__title">{event.title}</span>
                    <span className="card__meta">
                      <time dateTime={toDateTimeAttr(event.startsAt)}>{formatEventDateTime(event.startsAt)}</time>
                      {" · "}
                      {event.location}
                    </span>
                    <span className="card__meta">
                      <span className="badge">{gameTypeLabel(event.gameType)}</span> Hosted by {event.organizerName}
                    </span>
                  </Link>
                  <div className="card__row">
                    <SeatChip
                      seatsLeft={event.seatsLeft}
                      capacity={event.capacity}
                      isFull={event.isFull}
                      status={event.status}
                    />
                    <Link className="btn btn--sm btn--secondary" to={`/admin/events/${event.id}`}>
                      Manage
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <Pager
            page={events.data.page}
            hasNext={events.data.hasNext}
            busy={events.isFetching}
            onChange={(next) => update({ page: String(next) })}
          />
        </>
      )}
    </AdminPage>
  );
}
