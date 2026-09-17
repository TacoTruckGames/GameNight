/**
 * The operator site's own frame.
 *
 * Deliberately not the app's `AppShell`. The main site links here from nowhere —
 * no tab, no menu item, nothing in the identity picker — so the only way in is
 * to type `/admin`. Everything below the orange bar should therefore announce
 * that you have arrived somewhere else.
 *
 * It is also a different session: the operator identity is stored under its own
 * key, so signing in here leaves the board's identity alone and "Exit to site"
 * puts you back as whoever you were. `AdminGate` below is not a door but the
 * sign-in itself, rendered only while it is happening.
 *
 * The bar is the same orange in both themes and is never dismissible: "am I
 * about to change live data?" must not depend on which theme you are in or on
 * noticing a subtle tint.
 */

import { Link, Outlet } from "react-router";
import { Logo } from "../components/Logo";
import { useIdentity } from "../identity/IdentityContext";
import { AdminGate } from "./AdminGate";

export function AdminShell() {
  const { user, isAdmin } = useIdentity();

  return (
    <div className="shell">
      <div className="admin-bar">
        <span className="admin-bar__tag">Admin</span>
        <span className="admin-bar__text">Operator tools — changes here affect the live board.</span>
        <Link className="admin-bar__exit" to="/">
          Exit to site
        </Link>
      </div>

      <header className="shell__header">
        <div className="shell__header-inner">
          <span className="brand">
            <Logo />
            Game Night
          </span>
          {isAdmin && user ? <span className="shell__identity-name">{user.name}</span> : null}
        </div>
      </header>

      {/* No bottom tab bar here, so the main column does not need to reserve
          room for one. The section chips inside each page are the admin's nav. */}
      <main className="shell__main shell__main--flush">{isAdmin ? <Outlet /> : <AdminGate />}</main>
    </div>
  );
}
