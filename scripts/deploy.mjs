#!/usr/bin/env node
/**
 * Build and deploy to Cloudflare: https://gamenight.tacotruckgames.com
 *
 *   pnpm deploy            # build → apply remote D1 migrations → wrangler deploy
 *   pnpm db:seed:remote    # (separately, on purpose) load the demo board into prod
 *
 * Credentials come from `.env` (see .env.example) and are only ever handed to
 * wrangler through the environment — they are never written into any file that
 * ships. CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false stops wrangler and the Vite
 * plugin from also treating `.env` as Worker dev vars, which would otherwise copy
 * the values into `dist/gamenight/.dev.vars` during the build.
 *
 * The Vite build emits `.wrangler/deploy/config.json`, which `wrangler deploy`
 * follows automatically, so no --config flag is needed here.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DB = "gamenight";
const URL_ = "https://gamenight.tacotruckgames.com";
const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

if (existsSync(envFile)) process.loadEnvFile(envFile);
for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  if (!process.env[name]) {
    console.error(`${name} is not set — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const childEnv = {
  ...process.env,
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
};

/**
 * @param {string} label @param {string} bin @param {string[]} args
 * @param {{ input?: string }} [opts] — `input` is fed to stdin. `wrangler d1
 *   migrations apply --remote` asks "continue?" and, unlike the local variant,
 *   does not reliably auto-accept under CI=1, so the migration step answers it.
 */
function run(label, bin, args, opts = {}) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: [opts.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    input: opts.input,
    cwd: root,
    env: childEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\n${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// All three configs — the README says "typecheck → build", and a deploy that
// checked only the Worker would let a client type error ship.
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
for (const config of ["tsconfig.json", "tsconfig.worker.json", "test/tsconfig.json"]) {
  run(`Typecheck (${config})`, tsc, ["-p", config, "--noEmit"]);
}
// The JS entrypoints, not the `.bin` shims: `run` hands the path to node.
run("Lint", fileURLToPath(new URL("../node_modules/eslint/bin/eslint.js", import.meta.url)), ["."]);
run("Format check", fileURLToPath(new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url)), [
  "--check",
  ".",
]);
run("Building client + worker", viteBin, ["build"]);
run(`Applying migrations to remote D1 "${DB}"`, wranglerBin, ["d1", "migrations", "apply", DB, "--remote"], {
  input: "y\n",
});
run("Deploying worker", wranglerBin, ["deploy"]);

console.log(`\n✓ Deployed: ${URL_}`);
console.log(`  First deploy? Load the demo board with: pnpm db:seed:remote\n`);
