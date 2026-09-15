/**
 * The Hono generic used by every route and middleware in this Worker.
 *
 * Lives in its own module so `lib/`, `middleware/` and `routes/` can all refer
 * to it without importing each other.
 */

import type { User } from "../../shared/api-types";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /**
     * The caller, resolved from `X-User-Id` by `middleware/auth.ts`.
     * `null` means "no header" — an unknown id is a 401 before any handler runs.
     */
    user: User | null;
  };
};
