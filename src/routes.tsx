/**
 * The route table. Role is a hard redirect rather than a hidden link: a player
 * who deep-links to `/organize` lands somewhere useful instead of on a 403.
 */

import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { useIdentity } from "./identity/IdentityContext";
import { AttendeesPage } from "./pages/AttendeesPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventsPage } from "./pages/EventsPage";
import { MyEventsPage } from "./pages/MyEventsPage";
import { OrganizerPage } from "./pages/OrganizerPage";

function PlayerOnly({ children }: { children: ReactNode }) {
  const { isOrganizer } = useIdentity();
  return isOrganizer ? <Navigate to="/organize" replace /> : <>{children}</>;
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
