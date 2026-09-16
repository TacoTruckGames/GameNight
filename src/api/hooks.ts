/**
 * Every server interaction in the app, as TanStack Query hooks.
 *
 * Freshness policy (S3), in one place:
 *   - lists are fresh for 10 s and refetch on mount and on window focus, so
 *     coming back to the tab on a train shows real seat counts;
 *   - **no optimistic updates**. An RSVP is exactly the thing that can be
 *     refused by the server (the last seat), so the button shows a pending
 *     state and the card only changes once the server has spoken. The 201 /
 *     200 / 409 is always the truth;
 *   - after any write we invalidate `["events"]` and `["me"]` — the card, the
 *     detail page and "My events" can never disagree;
 *   - a 409 `EVENT_FULL` toasts "Just filled up" and refreshes, which is the
 *     honest story for someone who tapped a stale card.
 *
 * Retries: only `NetworkError`, max 2. Never an `ApiError` — a 403 will not
 * improve, and retrying is only safe at all because PUT/DELETE RSVP are
 * idempotent by contract (S2).
 */

import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  AttendeesResponse,
  EventDetail,
  EventSummary,
  RsvpResponse,
  User,
} from "../../shared/api-types";
import type { CreateEventInput, CreateUserInput } from "../../shared/schemas";
import { ApiError, NetworkError, apiFetch } from "./client";
import { SUSPENDED_MESSAGE, useIdentity } from "../identity/IdentityContext";
import { useToast } from "../components/Toast";

const STALE_TIME_MS = 10_000;
const MAX_RETRIES = 2;

function retryOnlyNetwork(failureCount: number, error: unknown): boolean {
  return error instanceof NetworkError && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: true,
        retry: retryOnlyNetwork,
      },
      mutations: {
        retry: retryOnlyNetwork,
      },
    },
  });
}

// ------------------------------------------------------------- query keys --

export interface EventsFilter {
  q?: string;
  gameType?: string;
  /** Omitted means the server's default (`date`). */
  sort?: string;
}

/** The admin lists are filtered entirely from the URL, so the key is the URL's query. */
export interface AdminUsersFilter {
  q?: string;
  role?: string;
  status?: string;
  page?: number;
}

export interface AdminEventsFilter {
  q?: string;
  when?: string;
  status?: string;
  page?: number;
}

export const queryKeys = {
  users: ["users"] as const,
  eventList: (filter: EventsFilter) =>
    ["events", "list", filter.q ?? "", filter.gameType ?? "", filter.sort ?? ""] as const,
  event: (id: string) => ["events", "detail", id] as const,
  attendees: (id: string) => ["events", "attendees", id] as const,
  myRsvps: (userId: string) => ["me", "rsvps", userId] as const,
  hosted: (userId: string) => ["me", "hosted", userId] as const,
  /** Everything the dashboard reads hangs off one prefix, so one write clears it all. */
  admin: {
    all: ["admin"] as const,
    overview: ["admin", "overview"] as const,
    users: (filter: AdminUsersFilter) =>
      ["admin", "users", filter.q ?? "", filter.role ?? "", filter.status ?? "", filter.page ?? 1] as const,
    events: (filter: AdminEventsFilter) =>
      ["admin", "events", "list", filter.q ?? "", filter.when ?? "", filter.status ?? "", filter.page ?? 1] as const,
    event: (id: string) => ["admin", "events", "detail", id] as const,
    errors: (status: string) => ["admin", "errors", status] as const,
  },
  /** One key for the whole app: the capability flags never vary by user. */
  mapsConfig: ["places", "config"] as const,
  /**
   * The session token is part of the key on purpose. It is what the Worker
   * forwards to Google, so two sessions are genuinely two different requests —
   * and within one session, backspacing back to a prefix is a cache hit and
   * costs nothing, which is where the de-duplication that makes this affordable
   * actually happens.
   */
  placeSuggestions: (q: string, session: string) => ["places", "suggest", session, q] as const,
};

// ----------------------------------------------------------------- queries --

export function useUsers(): UseQueryResult<User[], unknown> {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => apiFetch<User[]>("/api/users", { signal }),
  });
}

export function useEvents(filter: EventsFilter): UseQueryResult<EventSummary[], unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.eventList(filter),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      if (filter.gameType) params.set("gameType", filter.gameType);
      if (filter.sort) params.set("sort", filter.sort);
      const qs = params.toString();
      return apiFetch<EventSummary[]>(`/api/events${qs ? `?${qs}` : ""}`, { userId, signal });
    },
    // Keeps the previous list on screen while a debounced search resolves, so
    // typing never flashes the page back to skeletons.
    placeholderData: (previous) => previous,
  });
}

export function useEvent(id: string): UseQueryResult<EventDetail, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.event(id),
    queryFn: ({ signal }) => apiFetch<EventDetail>(`/api/events/${encodeURIComponent(id)}`, { userId, signal }),
    enabled: id !== "",
  });
}

export function useAttendees(id: string): UseQueryResult<AttendeesResponse, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.attendees(id),
    queryFn: ({ signal }) =>
      apiFetch<AttendeesResponse>(`/api/events/${encodeURIComponent(id)}/attendees`, { userId, signal }),
    enabled: id !== "" && userId !== null,
  });
}

/** The player's own RSVPs — the source of "You're in" on the event list. */
export function useMyRsvps(): UseQueryResult<EventSummary[], unknown> {
  const { userId, isPlayer } = useIdentity();
  return useQuery({
    queryKey: queryKeys.myRsvps(userId ?? "anonymous"),
    queryFn: ({ signal }) => apiFetch<EventSummary[]>("/api/me/rsvps", { userId, signal }),
    enabled: userId !== null && isPlayer,
  });
}

export function useHostedEvents(): UseQueryResult<EventSummary[], unknown> {
  const { userId, isOrganizer } = useIdentity();
  return useQuery({
    queryKey: queryKeys.hosted(userId ?? "anonymous"),
    queryFn: ({ signal }) => apiFetch<EventSummary[]>("/api/me/hosted", { userId, signal }),
    enabled: userId !== null && isOrganizer,
  });
}

/** Event ids the current player has a seat at. */
export function useMyRsvpIds(): Set<string> {
  const { data } = useMyRsvps();
  const ids = new Set<string>();
  for (const event of data ?? []) ids.add(event.id);
  return ids;
}

// ----------------------------------------------------------------- places --
// Maps is an enhancement bolted onto a product that works without it, so every
// hook here fails to "off" rather than to an error state.

/**
 * What the deployment can actually do, from `GET /api/places/config`. Two flags
 * and not one, because the two halves have separate quotas and either can be
 * switched off on its own.
 */
export interface MapsConfig {
  /** Venue autocomplete in the organizer and admin forms. */
  suggest: boolean;
  /** The static mini map on an event page. */
  map: boolean;
}

/** One place suggestion, already flattened by the Worker. */
export interface PlaceSuggestion {
  placeId: string;
  /** Usually the venue name — "Cardboard Castle". */
  primaryText: string;
  /** Usually the street and city — "412 Pine St, Seattle, WA". */
  secondaryText: string;
}

interface PlaceSuggestionsResponse {
  suggestions: PlaceSuggestion[];
}

/**
 * Degraded is the default, and a module constant so the identity is stable
 * across renders. A deployment with no key, a request in flight and a request
 * that failed all land here, and all three mean the same thing to the UI: show
 * the plain text input and no map.
 */
const MAPS_OFF: MapsConfig = { suggest: false, map: false };

/** Shorter than this, `GET /api/places/suggest` answers `[]` without calling out. */
export const PLACE_QUERY_MIN = 3;

const PLACE_SUGGEST_STALE_MS = 5 * 60_000;

/**
 * Call this ONLY from the two forms and the event detail page. The public board
 * must make zero extra requests to render — the flags change nothing there, and
 * a config fetch per card list would be a request the feature does not earn.
 *
 * `staleTime: Infinity` because a Worker secret cannot appear mid-session, and
 * `retry: false` because a failure and a `false` are the same answer.
 */
export function useMapsConfig({ enabled }: { enabled: boolean }): MapsConfig {
  const { data } = useQuery({
    queryKey: queryKeys.mapsConfig,
    queryFn: ({ signal }) => apiFetch<MapsConfig>("/api/places/config", { signal }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? MAPS_OFF;
}

/**
 * Venue suggestions for the combobox. Organizer- and admin-only server-side, so
 * this stays disabled without an identity rather than collecting 403s.
 *
 * The endpoint answers 200 with an empty array for every degraded path, so
 * "disabled", "over budget" and "upstream down" all arrive as "no matches" and
 * the caller needs no error branch.
 */
export function usePlaceSuggestions(
  q: string,
  session: string,
  enabled: boolean,
): UseQueryResult<PlaceSuggestion[], unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.placeSuggestions(q, session),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q, session });
      return apiFetch<PlaceSuggestionsResponse>(`/api/places/suggest?${params.toString()}`, {
        userId,
        signal,
      }).then((response) => response.suggestions);
    },
    enabled: enabled && userId !== null && session !== "" && q.length >= PLACE_QUERY_MIN,
    staleTime: PLACE_SUGGEST_STALE_MS,
    retry: false,
  });
}

// --------------------------------------------------------------- mutations --

/** Invalidate everything a write can touch: both lists, the detail, attendees. */
function useAfterWrite() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["events"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };
}

/**
 * An admin write can move anything: a suspension changes `/api/users` (the
 * picker), a cancelled event changes the board and everyone's "My events", and
 * every mutation adds an audit row to the overview. So it clears all four
 * prefixes rather than trying to be clever about which one moved.
 */
export function useAfterAdminWrite() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [["admin"], ["events"], ["me"], ["users"]]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function useCreateUser() {
  const { signIn } = useIdentity();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => apiFetch<User>("/api/users", { method: "POST", body: input }),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      signIn(user);
    },
  });
}

export function useCreateEvent() {
  const { userId } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      apiFetch<EventSummary>("/api/events", { method: "POST", body: input, userId }),
    onSuccess: afterWrite,
  });
}

/**
 * Shared error handling for the two RSVP writes. The interesting cases are all
 * "the world moved while you were reading": say so plainly, then refetch.
 */
function useRsvpErrorHandler() {
  const toast = useToast();
  const afterWrite = useAfterWrite();
  const { signOut } = useIdentity();

  return (error: unknown) => {
    if (error instanceof ApiError) {
      switch (error.code) {
        case "EVENT_FULL":
          toast.show("Just filled up — someone took the last seat.", "error");
          afterWrite();
          return;
        case "EVENT_STARTED":
          toast.show("That event has already started.", "error");
          afterWrite();
          return;
        case "EVENT_CANCELLED":
          toast.show("That event was cancelled.", "error");
          afterWrite();
          return;
        case "AUTH_REQUIRED":
        case "UNKNOWN_USER":
          toast.show("Pick who you are to continue.", "error");
          signOut();
          return;
        case "ACCOUNT_SUSPENDED":
          toast.show(SUSPENDED_MESSAGE, "error");
          signOut();
          return;
        default:
          toast.show(error.message, "error");
          return;
      }
    }
    if (error instanceof NetworkError) {
      toast.show(error.message, "error");
      return;
    }
    toast.show("Something went wrong. Please try again.", "error");
  };
}

export function useRsvp(eventId: string) {
  const { userId } = useIdentity();
  const toast = useToast();
  const afterWrite = useAfterWrite();
  const onError = useRsvpErrorHandler();

  return useMutation({
    mutationFn: () =>
      apiFetch<RsvpResponse>(`/api/events/${encodeURIComponent(eventId)}/rsvp`, { method: "PUT", userId }),
    onSuccess: (result) => {
      toast.show(result.status === "confirmed" ? "You're in." : "You already had a seat.");
      afterWrite();
    },
    onError,
  });
}

export function useCancelRsvp(eventId: string) {
  const { userId } = useIdentity();
  const toast = useToast();
  const afterWrite = useAfterWrite();
  const onError = useRsvpErrorHandler();

  return useMutation({
    mutationFn: () =>
      apiFetch<RsvpResponse>(`/api/events/${encodeURIComponent(eventId)}/rsvp`, { method: "DELETE", userId }),
    onSuccess: (result) => {
      toast.show(result.status === "cancelled" ? "RSVP cancelled — seat released." : "You weren't on the list.");
      afterWrite();
    },
    onError,
  });
}
