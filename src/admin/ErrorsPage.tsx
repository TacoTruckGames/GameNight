/**
 * What the Worker has been failing at.
 *
 * One card per fingerprint, not per occurrence — a route that throws a thousand
 * times is one problem, and `×1000` says more than a thousand rows would. The
 * stack sits in a collapsed `<details>` so the page stays a list of problems
 * rather than a wall of frames.
 *
 * Resolve keeps the row (a recurrence reopens it and the count keeps climbing);
 * Dismiss deletes it, so it is the one behind a confirm.
 */

import { useSearchParams } from "react-router";
import type { ErrorEntry } from "../../shared/api-types";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Skeleton } from "../components/Skeleton";
import { formatEventDateTime, toDateTimeAttr } from "../lib/datetime";
import { AdminPage } from "./AdminNav";
import type { ErrorsStatus } from "./hooks";
import { useAdminErrors, useDismissError, useResolveError } from "./hooks";

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const satisfies readonly { value: ErrorsStatus; label: string }[];

function ErrorCard({ entry }: { entry: ErrorEntry }) {
  const resolve = useResolveError();
  const dismiss = useDismissError();
  const busy = resolve.isPending || dismiss.isPending;

  return (
    <li className="card">
      <div className="admin-row">
        <span className="badge admin-mono">{entry.scope}</span>
        <span className={entry.count > 1 ? "admin-pill admin-pill--danger tnum" : "admin-pill tnum"}>
          ×{entry.count}
        </span>
      </div>

      <p className="admin-message">{entry.message}</p>

      <p className="card__meta">
        First <time dateTime={toDateTimeAttr(entry.firstSeenAt)}>{formatEventDateTime(entry.firstSeenAt)}</time> · last{" "}
        <time dateTime={toDateTimeAttr(entry.lastSeenAt)}>{formatEventDateTime(entry.lastSeenAt)}</time> (your local
        time)
      </p>

      {entry.resolvedAt ? (
        <p className="text-sm muted">
          Resolved <time dateTime={toDateTimeAttr(entry.resolvedAt)}>{formatEventDateTime(entry.resolvedAt)}</time> — it
          will reopen if it happens again.
        </p>
      ) : null}

      {entry.metadata ? <p className="card__meta admin-mono">{JSON.stringify(entry.metadata)}</p> : null}

      {entry.stack ? (
        <details className="admin-details">
          <summary>Stack trace</summary>
          <pre className="admin-stack">{entry.stack}</pre>
        </details>
      ) : null}

      <div className="admin-actions">
        {entry.resolvedAt ? null : (
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            disabled={busy}
            onClick={() => resolve.mutate(entry.id)}
          >
            {resolve.isPending ? "Resolving…" : "Resolve"}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm btn--danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Dismiss this error? The row is deleted and the count starts over if it recurs."))
              return;
            dismiss.mutate(entry.id);
          }}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

export function AdminErrorsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") ?? "open";
  const status: ErrorsStatus = raw === "resolved" || raw === "all" ? raw : "open";
  const errors = useAdminErrors(status);

  return (
    <AdminPage title="Errors" subtitle="Backend failures, grouped and counted.">
      <div className="chip-row" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className="chip"
            aria-pressed={status === filter.value}
            onClick={() => setParams({ status: filter.value }, { replace: true })}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {errors.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading errors">
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      ) : errors.isError ? (
        <ErrorBanner error={errors.error} onRetry={() => void errors.refetch()} />
      ) : errors.data.length === 0 ? (
        <EmptyState
          title={status === "open" ? "Nothing is broken" : "No errors here"}
          hint="Use “Send test error” on the Overview to check the pipeline."
        />
      ) : (
        <ul className="stack" aria-busy={errors.isFetching}>
          {errors.data.map((entry) => (
            <ErrorCard entry={entry} key={entry.id} />
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
