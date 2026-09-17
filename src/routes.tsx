/**
 * The route table.
 *
 * Two shells, on purpose. Everything the public uses hangs off `AppShell`;
 * `/admin` hangs off `AdminShell`, which carries the orange operator bar. The
 * main site never links or redirects into `/admin` — an operator types the URL,
 * and typing it is the whole entry mechanism: the tools sign themselves in as
 * the provisioned operator account.
 *
 * The two shells also remember two different people. `/admin` keeps its own
 * stored identity, so the tools can be open in one tab as the operator while
 * the board is open in another as Alice, and neither one moves the other.
 *
 * Within the main site, role is a redirect rather than a hidden link: a player
 * who deep-links `/organize` lands somewhere useful instead of on a 403.
 *
 * **`/events/:id` has two renderings**, and which one you get depends on how you
 * arrived. Tapping a card passes `state.backgroundLocation`, so the board keeps
 * rendering underneath and the event opens as a sheet over it — the list does
 * not lose its scroll position, and closing is Back. A typed URL, a shared link
 * or a refresh carries no such state, so the same route renders as a full page.
 * One element, one data hook, two frames; no duplicated state and nothing about
 * the URL changes, so a sheet is still a link you can send someone.
 */

import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AdminShell } from "./admin/AdminShell";
import { AdminErrorsPage } from "./admin/ErrorsPage";
import { AdminEventDetailPage } from "./admin/EventDetailPage";
import { AdminEventsPage } from "./admin/EventsPage";
import { AdminOverviewPage } from "./admin/OverviewPage";
import { AdminUsersPage } from "./admin/UsersPage";
import { AppShell } from "./components/AppShell";
import { useIdentity } from "./identity/IdentityContext";
import { AttendeesPage } from "./pages/AttendeesPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventsPage } from "./pages/EventsPage";
import { MyRsvpPage } from "./pages/MyRsvpPage";
import { OrganizerPage } from "./pages/OrganizerPage";

/** Role guards for the board's two personal pages. An operator is not a role
    the board can be in at all — see `IdentityContext` — so these are only ever
    deciding between a player and an organizer. */
function PlayerOnly({ children }: { children: ReactNode }) {
  const { isPlayer } = useIdentity();
  return isPlayer ? <>{children}</> : <Navigate to="/" replace />;
}

function OrganizerOnly({ children }: { children: ReactNode }) {
  const { isOrganizer } = useIdentity();
  return isOrganizer ? <>{children}</> : <Navigate to="/" replace />;
}

export function AppRoutes() {
  const location = useLocation();
  // Set only by a `<Link>` that meant "open this over what I am looking at".
  const state = location.state as { backgroundLocation?: Location } | null;
  const background = state?.backgroundLocation;

  return (
    <>
      <Routes location={background ?? location}>
      <Route element={<AppShell />}>
        <Route index element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route
          path="me"
          element={
            <PlayerOnly>
              <MyRsvpPage />
            </PlayerOnly>
          }
        />
        <Route
          path="organize"
          element={
            <OrganizerOnly>
              <OrganizerPage />
            </OrganizerOnly>
          }
        />
        <Route
          path="organize/events/:id"
          element={
            <OrganizerOnly>
              <AttendeesPage />
            </OrganizerOnly>
          }
        />
      </Route>

      {/* `AdminShell` signs itself in when the tools have no stored operator
          yet, so these paths never redirect away — typing the URL is the whole
          entry mechanism. The API is the real gate (403 `FORBIDDEN`). */}
      <Route path="admin" element={<AdminShell />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="events" element={<AdminEventsPage />} />
        <Route path="events/:id" element={<AdminEventDetailPage />} />
        <Route path="errors" element={<AdminErrorsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* The sheet, rendered *in addition to* the board above it. Only when the
          navigation asked for it — otherwise the route above already drew the
          full page and a second copy would mount the same query twice. */}
      {background ? (
        <Routes>
          <Route path="events/:id" element={<EventDetailPage asSheet />} />
          <Route
            path="organize/events/:id"
            element={
              <OrganizerOnly>
                <AttendeesPage asSheet />
              </OrganizerOnly>
            }
          />
        </Routes>
      ) : null}
    </>
  );
}
