/**
 * The error state (S4). Always offers a way forward: Retry for anything the
 * user can retry, and a plain sentence otherwise.
 *
 * Server messages are written for humans (`{ error: { message } }`), so they
 * are shown as-is; anything unrecognised gets a generic line rather than a
 * stack trace.
 */

import { ApiError, NetworkError } from "../api/client";
import { Icon } from "./Icon";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  return "Something went wrong.";
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      <span className="banner__text">
        <Icon name="alert" />
        {errorMessage(error)}
      </span>
      {onRetry ? (
        <button type="button" className="btn btn--sm btn--secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
