/**
 * Worker entrypoint.
 *
 * Both exports matter to the runtime: the default export handles requests, and
 * the named `EventRoom` class is what `[[durable_objects.bindings]]` in
 * `wrangler.toml` resolves `class_name` against.
 */

import app from "./app";

export { EventRoom } from "./do/EventRoom";

export default app;
