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
  eventList: (filter: EventsFilter) => ["events", "list", filter.q ?? "", filter.gameType ?? ""] as const,
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
