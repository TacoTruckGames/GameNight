/**
 * Secrets.
 *
 * These live outside `wrangler.toml` (they are set with `wrangler secret put`),
 * so `wrangler types` — which regenerates `worker-configuration.d.ts` wholesale
 * from the config file — will never emit them. Declared here instead, following
 * the same augmentation pattern `test/env.d.ts` uses for its test bindings.
 *
 * Optional on purpose: "no maps key configured" is a supported deployment, and
 * the type should say so. Every consumer goes through `placesFromEnv()`, which
 * returns null when the key is absent, so the whole feature switches off from
 * one place.
 */

declare namespace Cloudflare {
  interface Env {
    /** Google Maps Platform key: Places API (New) + Maps Static API only. */
    GOOGLE_MAPS_API_KEY?: string;
    /** Optional. Signs Maps Static API URLs when the project requires it. */
    GOOGLE_MAPS_SIGNING_SECRET?: string;
    /** Test-only override for the Places origin, so a suite can point at a dead port. */
    PLACES_ORIGIN?: string;
  }
}

interface Env {
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_MAPS_SIGNING_SECRET?: string;
  PLACES_ORIGIN?: string;
}
