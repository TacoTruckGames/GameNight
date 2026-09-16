/**
 * Boot gate.
 *
 * Nothing renders against a half-known identity: while `GET /api/me` is in
 * flight the app shows placeholders, a dead server shows a retryable error,
 * and an unknown/absent user gets the picker instead of a broken signed-in UI.
 */

import { useLocation } from "react-router";
import { AppRoutes } from "./routes";
import { ErrorBanner } from "./components/ErrorBanner";
import { Logo } from "./components/Logo";
import { Skeleton } from "./components/Skeleton";
import { NetworkError } from "./api/client";
import { useIdentity } from "./identity/IdentityContext";
import { WhoAreYou } from "./identity/WhoAreYou";

export function App() {
  const { status, retry } = useIdentity();
  const { pathname } = useLocation();

  if (status === "loading") {
    return (
      <main className="who who--full" role="status" aria-busy="true" aria-label="Starting Game Night">
        <p className="brand">
          <Logo />
          Game Night
        </p>
        <Skeleton height={56} />
        <Skeleton height={56} />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="who who--full">
        <h1 className="brand page-title">
          <Logo size={32} />
          Game Night
        </h1>
        <ErrorBanner error={new NetworkError("Couldn't reach the server to check who you are.")} onRetry={retry} />
      </main>
    );
  }

  // `/admin` owns its own door (`AdminGate`), so a stranger who types that URL
  // must not be handed the player picker instead — it would be the one place
  // the main site "leaked" into the operator route, just in the other
  // direction. Every other path without an identity gets the picker.
  if (status === "anonymous" && !pathname.startsWith("/admin")) return <WhoAreYou />;

  return <AppRoutes />;
}
