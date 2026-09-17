/**
 * Every `/api/admin/*` call, as TanStack Query hooks.
 *
 * Same policy as `src/api/hooks.ts` — no optimistic updates, the server is the
 * truth — with one addition: an admin write can move anything on the board, so
 * all of them share `useAfterAdminWrite()` (see `src/api/hooks.ts`).
 *
 * Mutations toast on success here rather than in each page, so "Suspended." and
 * "Event cancelled." read the same wherever they are triggered from.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  AdminEvent,
  AdminEventDetail,
  AdminOverview,
  AdminUser,
  ErrorEntry,
  Page,
  RsvpResponse,
} from "../../shared/api-types";
import type { EventPatch } from "../../shared/schemas";
import { ApiError, apiFetch } from "../api/client";
import type { AdminEventsFilter, AdminUsersFilter } from "../api/hooks";
import { queryKeys, useAfterAdminWrite } from "../api/hooks";
import { errorMessage } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useIdentity } from "../identity/IdentityContext";

export type ErrorsStatus = "open" | "resolved" | "all";

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

// ----------------------------------------------------------------- queries --

export function useAdminOverview(): UseQueryResult<AdminOverview, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.admin.overview,
    queryFn: ({ signal }) => apiFetch<AdminOverview>("/api/admin/overview", { userId, signal }),
    enabled: userId !== null,
  });
}

export function useAdminUsers(filter: AdminUsersFilter): UseQueryResult<Page<AdminUser>, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.admin.users(filter),
    queryFn: ({ signal }) =>
      apiFetch<Page<AdminUser>>(withQuery("/api/admin/users", { ...filter }), { userId, signal }),
    enabled: userId !== null,
    // Keeps the current page on screen while a debounced search resolves.
    placeholderData: (previous) => previous,
  });
}

export function useAdminEvents(filter: AdminEventsFilter): UseQueryResult<Page<AdminEvent>, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.admin.events(filter),
    queryFn: ({ signal }) =>
      apiFetch<Page<AdminEvent>>(withQuery("/api/admin/events", { ...filter }), { userId, signal }),
    enabled: userId !== null,
    placeholderData: (previous) => previous,
  });
}

export function useAdminEvent(id: string): UseQueryResult<AdminEventDetail, unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.admin.event(id),
    queryFn: ({ signal }) =>
      apiFetch<AdminEventDetail>(`/api/admin/events/${encodeURIComponent(id)}`, { userId, signal }),
    enabled: id !== "" && userId !== null,
  });
}

export function useAdminErrors(status: ErrorsStatus): UseQueryResult<ErrorEntry[], unknown> {
  const { userId } = useIdentity();
  return useQuery({
    queryKey: queryKeys.admin.errors(status),
    queryFn: ({ signal }) => apiFetch<ErrorEntry[]>(withQuery("/api/admin/errors", { status }), { userId, signal }),
    enabled: userId !== null,
  });
}

// --------------------------------------------------------------- mutations --

/** The shared shape of the eight admin writes: call, toast, invalidate everything. */
function useAdminMutation<TVariables, TResult>(
  request: (userId: string | null, variables: TVariables) => Promise<TResult>,
  message: (result: TResult, variables: TVariables) => string,
  /** The event edit form reports failures on its own fields, so it opts out. */
  toastErrors = true,
) {
  const { userId } = useIdentity();
  const toast = useToast();
  const afterWrite = useAfterAdminWrite();

  return useMutation({
    mutationFn: (variables: TVariables) => request(userId, variables),
    onSuccess: (result, variables) => {
      toast.show(message(result, variables));
      afterWrite();
    },
    onError: (error: unknown) => {
      if (toastErrors) toast.show(errorMessage(error), "error");
    },
  });
}

export function useSuspendUser(id: string) {
  return useAdminMutation<{ reason?: string }, AdminUser>(
    (userId, body) =>
      apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/suspend`, {
        method: "POST",
        body,
        userId,
      }),
    (user) => `${user.name} is suspended.`,
  );
}

export function useUnsuspendUser(id: string) {
  return useAdminMutation<void, AdminUser>(
    (userId) =>
      apiFetch<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/unsuspend`, { method: "POST", userId }),
    (user) => `${user.name} is active again.`,
  );
}

export function usePatchEvent(id: string) {
  return useAdminMutation<EventPatch, AdminEvent>(
    (userId, patch) =>
      apiFetch<AdminEvent>(`/api/admin/events/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, userId }),
    () => "Event updated.",
    false,
  );
}

export function useSetEventStatus(id: string) {
  return useAdminMutation<"cancel" | "restore", AdminEvent>(
    (userId, action) =>
      apiFetch<AdminEvent>(`/api/admin/events/${encodeURIComponent(id)}/${action}`, { method: "POST", userId }),
    (_event, action) => (action === "cancel" ? "Event cancelled." : "Event restored."),
  );
}

export function useRemoveAttendee(id: string) {
  return useAdminMutation<{ playerId: string; name: string }, RsvpResponse>(
    (userId, { playerId }) =>
      apiFetch<RsvpResponse>(
        `/api/admin/events/${encodeURIComponent(id)}/attendees/${encodeURIComponent(playerId)}`,
        { method: "DELETE", userId },
      ),
    (_result, { name }) => `${name} removed — seat released.`,
  );
}

export function useResolveError() {
  return useAdminMutation<string, unknown>(
    (userId, errorId) =>
      apiFetch<unknown>(`/api/admin/errors/${encodeURIComponent(errorId)}/resolve`, { method: "POST", userId }),
    () => "Marked resolved.",
  );
}

export function useDismissError() {
  return useAdminMutation<string, unknown>(
    (userId, errorId) =>
      apiFetch<unknown>(`/api/admin/errors/${encodeURIComponent(errorId)}`, { method: "DELETE", userId }),
    () => "Error dismissed.",
  );
}

/**
 * The end-to-end check of the error pipeline: the route throws on purpose, so a
 * 500 `INTERNAL` is the *success* case. Anything else (401, 403, a network
 * failure) is a real failure and is rethrown.
 */
export function useProbeError() {
  return useAdminMutation<void, void>(
    async (userId) => {
      try {
        await apiFetch<unknown>("/api/admin/errors/probe", { method: "POST", userId });
      } catch (error) {
        if (error instanceof ApiError && error.code === "INTERNAL") return;
        throw error;
      }
    },
    () => "Recorded — see Errors",
  );
}
