/**
 * The door at `/admin`.
 *
 * Since the main site offers no route in, this is where an operator arrives
 * when they type the URL without an operator identity. It lists the admin
 * accounts the operator provisioned — self-signup cannot create one, because
 * `SIGNUP_ROLES` excludes `admin` — and signs you in as the one you choose.
 *
 * This is emphatically not authentication: on a demo board anyone who knows the
 * URL can pick an operator here, exactly as anyone can pick a seeded organizer
 * on the main site. The README's "before real traffic" list says so first. What
 * the server will *let* an operator do is the part that is really enforced.
 */

import type { User } from "../../shared/api-types";
import { useUsers } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "../identity/IdentityContext";

export function AdminGate() {
  const { user, signIn } = useIdentity();
  const users = useUsers();
  const admins = (users.data ?? []).filter((person) => person.role === "admin");

  function enter(admin: User) {
    signIn(admin);
  }

  return (
    <div className="stack stack--loose">
      <div>
        <h1 className="page-title">Operator access</h1>
        <p className="page-subtitle">
          {user
            ? `You're signed in as ${user.name}, who isn't an operator. Continue as one to use these tools.`
            : "Continue as one of the provisioned operator accounts."}
        </p>
      </div>

      {users.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading operators">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : users.isError ? (
        <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
      ) : admins.length === 0 ? (
        <EmptyState
          title="No operator accounts"
          hint="Seed one with role 'admin' — the sign-up API cannot create it."
        />
      ) : (
        <ul className="stack">
          {admins.map((admin) => (
            <li key={admin.id}>
              <button type="button" className="btn btn--block" onClick={() => enter(admin)}>
                Continue as {admin.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm muted">
        Not what you were looking for? <a href="/">Back to the event board</a>.
      </p>
    </div>
  );
}
