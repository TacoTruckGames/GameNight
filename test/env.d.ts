/**
 * Extra bindings that only exist under vitest.
 *
 * NOTE for whoever writes the tests: @cloudflare/vitest-plugin 1.1.10 types
 * `env` from "cloudflare:test" as `Cloudflare.Env` — there is no `ProvidedEnv`
 * interface any more — so the augmentation target is the `Cloudflare`
 * namespace that `worker-configuration.d.ts` declares.
 */

declare namespace Cloudflare {
  interface Env {
    /** Populated from `readD1Migrations()` in vitest.config.ts. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
