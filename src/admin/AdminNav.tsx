/**
 * The dashboard's own nav: four chips, because the bottom tab bar already
 * belongs to the app and the admin's four views are siblings, not a hierarchy.
 *
 * Same `.chip` styling as the game-type filter, so "which section am I in" looks
 * exactly like "which filter is on" everywhere else. These are links, not
 * toggles, so the selected one is `aria-current="page"` rather than
 * `aria-pressed` — `base.css` gives the two states one rule.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

const SECTIONS = [
  { to: "/admin", label: "Overview" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/events", label: "Events" },
  { to: "/admin/errors", label: "Errors" },
] as const;

/** Title, subtitle, nav — the frame all five admin pages share. */
export function AdminPage({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="stack stack--loose">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
        <AdminNav />
      </div>
      {children}
    </div>
  );
}

export function AdminNav() {
  const { pathname } = useLocation();

  return (
    <nav className="chip-row" aria-label="Admin sections">
      {SECTIONS.map((section) => {
        // `/admin/events/:id` still belongs to Events.
        const current = section.to === "/admin" ? pathname === "/admin" : pathname.startsWith(section.to);
        return (
          <Link
            key={section.to}
            to={section.to}
            className="chip admin-chip-link"
            aria-current={current ? "page" : undefined}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
