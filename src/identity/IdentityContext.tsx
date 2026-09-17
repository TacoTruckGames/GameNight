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
 * ## Two identities, never one
 *
 * The board and `/admin` are different sites that happen to share a bundle, and
 * they remember different people. An operator opening the tools does not stop
 * being Alice on the board, and coming back from "Exit to site" lands on Alice's
 * RSVPs again rather than on an operator account holding a seat at a table.
 *
 * So the stored id is keyed by *surface*, decided by the path, and an admin is
 * not a role the board can be in: a site identity that resolves to `admin` is
 * moved over to the operator key and the board falls back to the picker. That
 * case is real — before the split, entering the tools overwrote the one stored
 * id, so browsers that used the old door are carrying an operator as their
 * board identity right now.
 *
 * Every `localStorage` access is wrapped: Safari private mode throws.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import type { User } from "../../shared/api-types";
import { ApiError, apiFetch } from "../api/client";
import { useToast } from "../components/Toast";

export const SUSPENDED_MESSAGE = "This account has been suspended.";

/** Which site you are on. `/admin` is its own, with its own memory. */
export type Surface = "site" | "admin";

const STORAGE_KEYS: Record<Surface, string> = {
  site: "gn.userId",
  admin: "gn.adminId",
};

export function surfaceFor(pathname: string): Surface {
  return pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "site";
}

function readStoredId(surface: Surface): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS[surface]);
  } catch {
    return null;
  }
}

function writeStoredId(surface: Surface, id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEYS[surface]);
    else window.localStorage.setItem(STORAGE_KEYS[surface], id);
  } catch {
    // Private browsing: identity is then session-only, which still works.
  }
}

export type IdentityStatus = "loading" | "anonymous" | "ready" | "error";

interface IdentityValue {
  status: IdentityStatus;
  /** Which site's identity this is — the board's, or the operator tools'. */
  surface: Surface;
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
  const surface = surfaceFor(useLocation().pathname);
  const [status, setStatus] = useState<IdentityStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Crossing between the board and the tools swaps *who you are*, and waiting
  // for an effect to notice would render one surface holding the other's user:
  // a frame of the operator bar over "you aren't an operator", or of the board
  // wearing an admin. Resetting during render is React's own answer to derived
  // state, and the boot effect below picks it up in the same commit.
  const [shownSurface, setShownSurface] = useState<Surface>(surface);
  if (shownSurface !== surface) {
    setShownSurface(surface);
    setUser(null);
    setStatus("loading");
  }

  // Skips the first run: clearing an empty cache would only cancel the queries
  // mounting alongside it.
  const lastCleared = useRef(surface);

  useEffect(() => {
    if (lastCleared.current !== surface) {
      lastCleared.current = surface;
      queryClient.removeQueries();
    }

    const storedId = readStoredId(surface);
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

        // An operator is not a person on the board. This is the one-way door
        // out of the state the old single-key storage left behind: hand the id
        // to the operator surface, which is where it belongs, and send the
        // board back to the picker rather than rendering a board for someone
        // who cannot RSVP to anything on it.
        if (surface === "site" && me.role === "admin") {
          writeStoredId("site", null);
          if (!readStoredId("admin")) writeStoredId("admin", me.id);
          setUser(null);
          setStatus("anonymous");
          return;
        }

        setUser(me);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        const suspended = error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED";
        if ((error instanceof ApiError && error.status === 401) || suspended) {
          // AUTH_REQUIRED / UNKNOWN_USER — the stored id is worthless now.
          // ACCOUNT_SUSPENDED — the id is real but unusable; say so, because a
          // picker appearing out of nowhere reads as a crash.
          writeStoredId(surface, null);
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
  }, [attempt, toast, surface, queryClient]);

  const signIn = useCallback(
    (next: User) => {
      writeStoredId(surface, next.id);
      setUser(next);
      setStatus("ready");
      // Nothing cached belongs to the new person — `myRsvp` on an event detail
      // is the obvious one. Queries only: an in-flight mutation is not theirs
      // to cancel.
      queryClient.removeQueries();
    },
    [queryClient, surface],
  );

  const signOut = useCallback(() => {
    writeStoredId(surface, null);
    setUser(null);
    setStatus("anonymous");
    queryClient.removeQueries();
  }, [queryClient, surface]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<IdentityValue>(
    () => ({
      status,
      surface,
      user,
      userId: user?.id ?? null,
      isPlayer: user?.role === "player",
      isOrganizer: user?.role === "organizer",
      isAdmin: user?.role === "admin",
      signIn,
      signOut,
      retry,
    }),
    [status, surface, user, signIn, signOut, retry],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return value;
}
