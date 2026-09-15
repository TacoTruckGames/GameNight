/**
 * The board. Search + game-type chips + a list of cards you can RSVP to
 * without leaving the page.
 *
 * `GET /api/events` is deliberately user-independent (so it stays cacheable),
 * so "You're in" comes from `GET /api/me/rsvps` and is joined here on the
 * client.
 */

import { useEffect, useId, useState } from "react";
import { SEARCH_MAX } from "../../shared/schemas";
import { useEvents, useMyRsvpIds } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { Icon } from "../components/Icon";
import { GameTypeFilter } from "../components/GameTypeFilter";
import { EventListSkeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";

const DEBOUNCE_MS = 250;

export function EventsPage() {
  const { isPlayer } = useIdentity();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gameType, setGameType] = useState("");
  const searchId = useId();

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const events = useEvents({ q: debouncedSearch, gameType });
  const myRsvpIds = useMyRsvpIds();
  const filtered = debouncedSearch !== "" || gameType !== "";

  return (
    <>
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
      </div>

      {events.isPending ? (
        <EventListSkeleton />
      ) : events.isError ? (
        <ErrorBanner error={events.error} onRetry={() => void events.refetch()} />
      ) : (events.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={filtered ? "No upcoming events match" : "No upcoming events yet"}
          hint={filtered ? "Try a different search or clear the filters." : "Check back soon — organizers post new tables regularly."}
          action={
            filtered ? (
              <button
                type="button"
                className="btn btn--sm btn--secondary"
                onClick={() => {
                  setSearch("");
                  setGameType("");
                }}
              >
                Clear filters
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="stack" aria-busy={events.isFetching}>
          {events.data?.map((event) => (
            <li key={event.id}>
              <EventCard event={event} joined={myRsvpIds.has(event.id)} showRsvp={isPlayer} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
