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
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Logo } from "./Logo";

function Tab({ to, label, icon, end = false }: { to: string; label: string; icon: IconName; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="tab">
      <Icon name={icon} />
      <span>{label}</span>
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
          <span className="brand">
            <Logo />
            Game Night
          </span>
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
          <Tab to="/" label="Events" icon="events" end />
          {isOrganizer ? (
            <Tab to="/organize" label="Organize" icon="organize" />
          ) : (
            <Tab to="/me" label="My events" icon="mine" />
          )}
        </div>
      </nav>

      {switching ? <WhoAreYou onClose={() => setSwitching(false)} /> : null}
    </div>
  );
}
