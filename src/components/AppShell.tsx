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

import { useRef, useState } from "react";
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
  const identityRef = useRef<HTMLButtonElement>(null);

  // Closing sends focus back to the button that opened it — a keyboard user who
  // presses Escape should not be dropped at the top of the document.
  const closeSwitcher = () => {
    setSwitching(false);
    identityRef.current?.focus();
  };

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
              {/* An organizer's board is their own events, so the tab says whose
                  it is. A player's is everybody's, and "Events" is already that. */}
              <Tab to="/" label={isOrganizer ? "Our Events" : "Events"} icon="events" end />
              {isOrganizer ? (
                <Tab to="/organize" label="Organize" icon="organize" />
              ) : isAdmin ? null : (
                <Tab to="/me" label="My RSVP" icon="player" />
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
          {/* The switcher hangs off this button, so it lives in the button's own
              positioning context rather than in a sheet at the bottom of the
              screen. Reopening is a toggle here only as a backstop: while it is
              open the switcher's scrim covers the header, so a click meant to
              close it lands there and never reaches this button. */}
          <div className="shell__identity-anchor">
            <button
              ref={identityRef}
              type="button"
              className={`btn btn--sm btn--ghost shell__identity${role ? ` shell__identity--${role}` : ""}`}
              onClick={() => setSwitching((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={switching}
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
            {switching ? <WhoAreYou onClose={closeSwitcher} /> : null}
          </div>
        </div>
      </header>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
