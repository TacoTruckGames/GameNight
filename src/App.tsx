/**
 * Boot gate.
 *
 * Nothing renders against a half-known identity: while `GET /api/me` is in
 * flight the app shows placeholders, a dead server shows a retryable error,
 * and an unknown/absent user gets the picker instead of a broken signed-in UI.
 */

import { AppRoutes } from "./routes";
import { ErrorBanner } from "./components/ErrorBanner";
import { Skeleton } from "./components/Skeleton";
import { NetworkError } from "./api/client";
import { useIdentity } from "./identity/IdentityContext";
import { WhoAreYou } from "./identity/WhoAreYou";

export function App() {
  const { status, retry } = useIdentity();

  if (status === "loading") {
    return (
      <main className="who who--full" role="status" aria-busy="true" aria-label="Starting Game Night">
        <Skeleton width="60%" height={28} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="who who--full">
        <h1 className="page-title">Game Night</h1>
        <ErrorBanner error={new NetworkError("Couldn't reach the server to check who you are.")} onRetry={retry} />
      </main>
    );
  }

  if (status === "anonymous") return <WhoAreYou />;

  return <AppRoutes />;
}
