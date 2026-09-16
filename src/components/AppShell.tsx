/**
 * The frame every page sits in: who you are and where you can go at the top,
 * one 640px column below.
 *
 * Bottom tabs rather than a drawer because the thumb is at the bottom of the
 * phone, and the tab set is role-dependent — a player never sees organizer
 * tools and vice versa.
 *
 * The <nav> lives inside the header in the markup but is pinned to the bottom
 * of the phone by CSS; on a desktop-width screen it stays where it is written,
 * inline in the header, where a mouse expects it. One DOM order, two layouts —
 * so tab order is brand → nav → identity either way.
 *
 * Nothing here links to `/admin`, on purpose: the operator tools are reached by
 * typing the URL, and they have their own shell (`src/admin/AdminShell.tsx`).
 * An admin signed in on the main site is just a reader of the board.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useIdentity } from "../identity/IdentityContext";
import { ROLE_ICONS, ROLE_LABELS } from "../lib/roles";
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
  const { user, isOrganizer, isAdmin } = useIdentity();
  const role = user?.role ?? null;
  const [switching, setSwitching] = useState(false);

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-inner">
          <span className="brand">
            <Logo />
            Game Night
          </span>
          <nav className="shell__tabs" aria-label="Main">
            <div className="shell__tabs-inner">
              <Tab to="/" label="Events" icon="events" end />
              {isOrganizer ? (
                <Tab to="/organize" label="Organize" icon="organize" />
              ) : isAdmin ? null : (
                <Tab to="/me" label="My events" icon="mine" />
              )}
            </div>
          </nav>
          {/* The name *is* the control. A separate "Switch" button spent header
              width restating what tapping your own name obviously does, and on
              a phone that width is what the name needed to stay readable.
              
              It also carries the role, because nothing else on the board did:
              the tab set is the only other signal and it sits at the bottom of
              a phone. Icon and tint at every width, the word where there is
              room for it, and the role in the accessible name always — so it is
              never colour alone doing the work. */}
          <button
            type="button"
            className={`btn btn--sm btn--ghost shell__identity${role ? ` shell__identity--${role}` : ""}`}
            onClick={() => setSwitching(true)}
            aria-label={
              user && role
                ? `Signed in as ${user.name}, ${ROLE_LABELS[role]} — switch user`
                : "Choose who you are"
            }
          >
            {role ? <Icon name={ROLE_ICONS[role]} size={16} /> : null}
            {role ? <span className="shell__identity-role">{ROLE_LABELS[role]} ·</span> : null}
            <span className="shell__identity-name">{user ? user.name : "Guest"}</span>
          </button>
        </div>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>

      {switching ? <WhoAreYou onClose={() => setSwitching(false)} /> : null}
    </div>
  );
}
