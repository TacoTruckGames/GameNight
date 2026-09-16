/**
 * Who the Worker thinks you are.
 *
 * There is no auth in this take-home: identity is a user id kept in
 * `localStorage` and sent as `X-User-Id`. The contract that matters to the UI
 * is what happens when that id stops being valid — a re-seeded database, a
 * shared link, a cleared table: `GET /api/me` answers 401 and we drop the
 * identity and show the picker instead of rendering a broken, half-signed-in
 * app.
 *
 * A suspended account is the same story with a different cause: the id is real
 * but an admin took it away (403 `ACCOUNT_SUSPENDED`). Dropping it silently
 * would look like a bug, so that one branch also says why, out loud.
 *
 * Every `localStorage` access is wrapped: Safari private mode throws.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "../../shared/api-types";
import { ApiError, apiFetch } from "../api/client";
import { useToast } from "../components/Toast";

export const SUSPENDED_MESSAGE = "This account has been suspended.";

const STORAGE_KEY = "gn.userId";

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing: identity is then session-only, which still works.
  }
}

export type IdentityStatus = "loading" | "anonymous" | "ready" | "error";

interface IdentityValue {
  status: IdentityStatus;
  user: User | null;
  userId: string | null;
  isPlayer: boolean;
  isOrganizer: boolean;
  isAdmin: boolean;
  signIn: (user: User) => void;
  signOut: () => void;
  /** Re-runs the boot check after a network failure. */
  retry: () => void;
}

const IdentityContext = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<IdentityStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const storedId = readStoredId();
    if (!storedId) {
      setUser(null);
      setStatus("anonymous");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    void (async () => {
      try {
        const me = await apiFetch<User>("/api/me", { userId: storedId });
        if (cancelled) return;
        setUser(me);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        const suspended = error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED";
        if ((error instanceof ApiError && error.status === 401) || suspended) {
          // AUTH_REQUIRED / UNKNOWN_USER — the stored id is worthless now.
          // ACCOUNT_SUSPENDED — the id is real but unusable; say so, because a
          // picker appearing out of nowhere reads as a crash.
          writeStoredId(null);
          setUser(null);
          setStatus("anonymous");
          if (suspended) toast.show(SUSPENDED_MESSAGE, "error");
          return;
        }
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, toast]);

  const signIn = useCallback(
    (next: User) => {
      writeStoredId(next.id);
      setUser(next);
      setStatus("ready");
      // Nothing cached belongs to the new person — `myRsvp` on an event detail
      // is the obvious one. Queries only: an in-flight mutation is not theirs
      // to cancel.
      queryClient.removeQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    writeStoredId(null);
    setUser(null);
    setStatus("anonymous");
    queryClient.removeQueries();
  }, [queryClient]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<IdentityValue>(
    () => ({
      status,
      user,
      userId: user?.id ?? null,
      isPlayer: user?.role === "player",
      isOrganizer: user?.role === "organizer",
      isAdmin: user?.role === "admin",
      signIn,
      signOut,
      retry,
    }),
    [status, user, signIn, signOut, retry],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return value;
}
