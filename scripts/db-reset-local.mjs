#!/usr/bin/env node
/**
 * Reset the LOCAL D1 database: apply every migration, then load the demo seed.
 *
 * Runs as `predev`, so `pnpm dev` always starts from a known board — the seed
 * dates are relative to now, so the FULL event and the one-seat-left event are
 * always present. The seed itself deletes before it inserts, so this is safe to
 * run repeatedly.
 *
 * CI=1 puts wrangler in non-interactive mode so `d1 migrations apply --local`
 * does not stop on its "About to apply N migrations, ok to proceed?" prompt.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DB = "gamenight";
const root = fileURLToPath(new URL("..", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

/** @param {string[]} args */
function wrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    stdio: "inherit",
    cwd: root,
    // CI=1 => wrangler never prompts. WRANGLER_SEND_METRICS=false keeps the
    // first-run telemetry question out of the way too.
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nwrangler ${args.join(" ")} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n▸ Applying migrations to local D1 "${DB}"…`);
wrangler(["d1", "migrations", "apply", DB, "--local"]);

console.log(`\n▸ Seeding local D1 "${DB}"…`);
wrangler(["d1", "execute", DB, "--local", "--file=./seed/seed.sql"]);

console.log("\n✓ Local database reset and seeded.\n");
