/**
 * The route table.
 *
 * Two shells, on purpose. Everything the public uses hangs off `AppShell`;
 * `/admin` hangs off `AdminShell`, which carries the orange operator bar. The
 * main site never links or redirects into `/admin` — an operator types the URL
 * — so a player who lands there deliberately gets a door, not a bounce.
 *
 * Within the main site, role is a redirect rather than a hidden link: a player
 * who deep-links `/organize` lands somewhere useful instead of on a 403.
 */

import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
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
import { MyEventsPage } from "./pages/MyEventsPage";
import { OrganizerPage } from "./pages/OrganizerPage";

/** An admin on the main site is just a reader: send them to the board, not to `/admin`. */
function PlayerOnly({ children }: { children: ReactNode }) {
  const { isPlayer } = useIdentity();
  return isPlayer ? <>{children}</> : <Navigate to="/" replace />;
}

function OrganizerOnly({ children }: { children: ReactNode }) {
  const { isOrganizer } = useIdentity();
  return isOrganizer ? <>{children}</> : <Navigate to="/" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route
          path="me"
          element={
            <PlayerOnly>
              <MyEventsPage />
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

      {/* `AdminShell` shows the operator door itself when the visitor is not an
          admin, so these paths never redirect away — typing the URL is the
          whole entry mechanism. The API is the real gate (403 `FORBIDDEN`). */}
      <Route path="admin" element={<AdminShell />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="events" element={<AdminEventsPage />} />
        <Route path="events/:id" element={<AdminEventDetailPage />} />
        <Route path="errors" element={<AdminErrorsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
