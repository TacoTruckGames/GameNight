/**
 * Everyone on the board, and the one lever that matters: suspension.
 *
 * Filters live in the URL so a suspicious account can be linked to a colleague,
 * and so Back works. A table would need horizontal scrolling on a phone, so each
 * user is a card — the same card the rest of the app uses.
 */

import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router";
import type { AdminUser } from "../../shared/api-types";
import { ALL_ROLES, SEARCH_MAX, SUSPEND_REASON_MAX } from "../../shared/schemas";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";
import { formatEventDateTime, toDateTimeAttr } from "../lib/datetime";
import { ROLE_LABELS } from "../lib/roles";
import { AdminPage } from "./AdminNav";
import { Pager } from "./Pager";
import { useAdminUsers, useSuspendUser, useUnsuspendUser } from "./hooks";

const DEBOUNCE_MS = 250;

const STATUS_FILTERS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

function UserRow({ user }: { user: AdminUser }) {
  const { userId } = useIdentity();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const suspend = useSuspendUser(user.id);
  const unsuspend = useUnsuspendUser(user.id);
  const busy = suspend.isPending || unsuspend.isPending;

  return (
    <li className="card">
      <div className="admin-row">
        <span className="card__title">{user.name}</span>
        <span className="badge">{ROLE_LABELS[user.role]}</span>
      </div>
      <p className="card__meta">
        Joined <time dateTime={toDateTimeAttr(user.createdAt)}>{formatEventDateTime(user.createdAt)}</time> ·{" "}
        <span className="tnum">{user.rsvpCount}</span> RSVPs · <span className="tnum">{user.hostedCount}</span> hosted
      </p>
      <p className="card__meta admin-mono">{user.id}</p>

      {user.suspendedAt ? (
        <div className="stack">
          <span className="admin-pill admin-pill--danger">
            <Icon name="alert" size={16} />
            Suspended <time dateTime={toDateTimeAttr(user.suspendedAt)}>{formatEventDateTime(user.suspendedAt)}</time>
          </span>
          {user.suspendedReason ? <p className="text-sm muted">“{user.suspendedReason}”</p> : null}
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            onClick={() => unsuspend.mutate()}
            disabled={busy}
            aria-busy={busy}
          >
            {unsuspend.isPending ? "Restoring…" : `Unsuspend ${user.name}`}
          </button>
        </div>
      ) : open ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (!window.confirm(`Suspend ${user.name}? They are signed out immediately and blocked from the API.`))
              return;
            suspend.mutate(trimmed === "" ? {} : { reason: trimmed }, {
              onSuccess: () => {
                setOpen(false);
                setReason("");
              },
            });
          }}
          noValidate
        >
          <div className="field">
            <label className="field__label" htmlFor={reasonId}>
              Reason (optional)
            </label>
            <input
              id={reasonId}
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={SUSPEND_REASON_MAX}
              placeholder="Repeated no-shows"
              autoFocus
            />
            <p className="text-sm muted">Kept in the audit log; the user never sees it.</p>
          </div>
          <div className="admin-actions">
            <button type="submit" className="btn btn--sm btn--danger" disabled={busy} aria-busy={busy}>
              {suspend.isPending ? "Suspending…" : "Confirm suspend"}
            </button>
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="admin-actions admin-actions--split">
          <span className="admin-pill admin-pill--ok">Active</span>
          {/* The API refuses self-suspension with a 400; don't offer the button. */}
          {user.id === userId ? (
            <span className="text-sm muted">That's you</span>
          ) : (
            <button type="button" className="btn btn--sm btn--danger" onClick={() => setOpen(true)}>
              Suspend
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const role = params.get("role") ?? "";
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const searchId = useId();

  const [search, setSearch] = useState(q);

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the page number — page 4 of the new result
    // set is usually empty.
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = useAdminUsers({ q, role, status, page });

  return (
    <AdminPage title="Users" subtitle="Search, filter, and suspend accounts.">
      <div className="filters">
        <div className="search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search users by name
          </label>
          <span className="search__icon">
            <Icon name="search" />
          </span>
          <input
            id={searchId}
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            maxLength={SEARCH_MAX}
            autoComplete="off"
          />
        </div>

        <div className="chip-row" role="group" aria-label="Filter by role">
          <button type="button" className="chip" aria-pressed={role === ""} onClick={() => update({ role: "" })}>
            All roles
          </button>
          {ALL_ROLES.map((value) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={role === value}
              onClick={() => update({ role: value })}
            >
              {ROLE_LABELS[value]}s
            </button>
          ))}
        </div>

        <div className="chip-row" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className="chip"
              aria-pressed={status === filter.value}
              onClick={() => update({ status: filter.value })}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {users.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading users">
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : users.isError ? (
        <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState title="No users match" hint="Try a different search or clear the filters." />
      ) : (
        <>
          <ul className="stack" aria-busy={users.isFetching}>
            {users.data.items.map((user) => (
              <UserRow user={user} key={user.id} />
            ))}
          </ul>
          <Pager
            page={users.data.page}
            hasNext={users.data.hasNext}
            busy={users.isFetching}
            onChange={(next) => update({ page: String(next) })}
          />
        </>
      )}
    </AdminPage>
  );
}
