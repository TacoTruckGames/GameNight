/**
 * The route table. Role is a hard redirect rather than a hidden link: a player
 * who deep-links to `/organize` lands somewhere useful instead of on a 403, and
 * an admin who deep-links to `/me` lands on the dashboard.
 */

import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
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

function PlayerOnly({ children }: { children: ReactNode }) {
  const { isOrganizer, isAdmin } = useIdentity();
  if (isAdmin) return <Navigate to="/admin" replace />;
  return isOrganizer ? <Navigate to="/organize" replace /> : <>{children}</>;
}

function OrganizerOnly({ children }: { children: ReactNode }) {
  const { isOrganizer, isAdmin } = useIdentity();
  if (isAdmin) return <Navigate to="/admin" replace />;
  return isOrganizer ? <>{children}</> : <Navigate to="/" replace />;
}

/** The API is the real gate (403 `FORBIDDEN`); this only keeps the UI honest. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useIdentity();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
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
        <Route
          path="admin"
          element={
            <AdminOnly>
              <AdminOverviewPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/users"
          element={
            <AdminOnly>
              <AdminUsersPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/events"
          element={
            <AdminOnly>
              <AdminEventsPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/events/:id"
          element={
            <AdminOnly>
              <AdminEventDetailPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/errors"
          element={
            <AdminOnly>
              <AdminErrorsPage />
            </AdminOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
