/**
 * The frame every page sits in: who you are at the top, where you can go at
 * the bottom, one 640px column in between.
 *
 * Bottom tabs rather than a drawer or a top nav because the thumb is at the
 * bottom of the phone, and the tab set is role-dependent — a player never sees
 * organizer tools and vice versa.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useIdentity } from "../identity/IdentityContext";
import { WhoAreYou } from "../identity/WhoAreYou";

function Tab({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="tab">
      <span>{label}</span>
      <span className="tab__dot" />
    </NavLink>
  );
}

export function AppShell() {
  const { user, isOrganizer } = useIdentity();
  const [switching, setSwitching] = useState(false);

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-inner">
          <span className="shell__brand">Game Night</span>
          <div className="shell__identity">
            <span className="shell__identity-name">{user ? user.name : "Guest"}</span>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSwitching(true)}>
              Switch
            </button>
          </div>
        </div>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>

      <nav className="shell__tabs" aria-label="Main">
        <div className="shell__tabs-inner">
          <Tab to="/" label="Events" end />
          {isOrganizer ? <Tab to="/organize" label="Organize" /> : <Tab to="/me" label="My events" />}
        </div>
      </nav>

      {switching ? <WhoAreYou onClose={() => setSwitching(false)} /> : null}
    </div>
  );
}
