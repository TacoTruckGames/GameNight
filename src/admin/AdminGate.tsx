/**
 * Arriving at `/admin`.
 *
 * There is no door any more. This is a demo board with one provisioned operator
 * account and no authentication to speak of — the click that said "Continue as
 * Site Admin" asked a question with one possible answer, and a reviewer typing
 * the URL should land in the tools, not in a lobby.
 *
 * So this signs itself in: fetch the users, take the operator account, done. It
 * renders only while that is in flight, or when it cannot be finished — no
 * operator account exists, or the list would not load. **`/admin` has its own
 * stored identity**, so this does not touch whoever is signed in on the board;
 * see `IdentityContext`.
 *
 * This is emphatically not authentication, and it is not pretending to be: on a
 * demo board anyone who knows the URL is an operator, exactly as anyone can pick
 * a seeded organizer on the main site. The README's "before real traffic" list
 * says so first. What the server will *let* an operator do is the part that is
 * really enforced.
 */

import { useEffect, useRef } from "react";
import { useUsers } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";

export function AdminGate() {
  const { signIn } = useIdentity();
  // Just the operator account, not the users table: `SIGNUP_ROLES` excludes
  // `admin`, so the API cannot mint another, and more than one is a decision
  // made in SQL — the first is as good an answer as any. Not a picker.
  const users = useUsers({ role: "admin", limit: 1 });
  const operator = users.data?.[0] ?? null;

  // `signIn` clears the query cache, which unmounts the query feeding this
  // component; without the latch its refetch would sign in again on arrival.
  const entered = useRef(false);

  useEffect(() => {
    if (entered.current || !operator) return;
    entered.current = true;
    signIn(operator);
  }, [operator, signIn]);

  if (users.isError) {
    return (
      <div className="stack stack--loose">
        <div>
          <h1 className="page-title">Operator tools</h1>
          <p className="page-subtitle">Couldn't load the operator account.</p>
        </div>
        <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
        <p className="text-sm muted">
          <a href="/">Back to the event board</a>.
        </p>
      </div>
    );
  }

  if (!users.isPending && !operator) {
    return (
      <div className="stack stack--loose">
        <h1 className="page-title">Operator tools</h1>
        <EmptyState title="No operator account" hint="Seed one with role 'admin' — the sign-up API cannot create it." />
        <p className="text-sm muted">
          <a href="/">Back to the event board</a>.
        </p>
      </div>
    );
  }

  // Signing in. Shaped like the page it is about to become, so the frame does
  // not jump when it arrives.
  return (
    <div className="stack stack--loose" role="status" aria-busy="true" aria-label="Opening the operator tools">
      <Skeleton width="60%" height={28} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </div>
  );
}
