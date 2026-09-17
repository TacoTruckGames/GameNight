#!/usr/bin/env node
/**
 * Game Night — read-path load test.
 *
 *   node scripts/loadtest.ts [baseUrl] [--seconds 15] [--budget 20000] [--json out.json]
 *
 * The brief's hot path is "the event list with live counts", at 100× the
 * launch read volume with 10× spikes on event days. This drives exactly those
 * shapes against a running server and reports what it saw, phase by phase:
 *
 *   list      GET /api/events                the board, upcoming            c=20
 *   calendar  GET /api/events?from=&to=      the month grid                 c=10
 *   detail    GET /api/events/:id            the sheet, rotating ids        c=10
 *   mine      GET /api/me/rsvps              per-user, rotating players     c=10
 *   spike     GET /api/events                the board at 5× concurrency    c=100
 *
 * Closed-loop: each worker sends the next request the moment the last answer
 * lands, so `c` is concurrent in-flight requests, not a rate. Latency is
 * measured at the client and includes the network — the number a phone sees.
 *
 * `--budget` caps the total request count across all phases and is the reason
 * this is safe to point at production: a Workers free plan allows 100,000
 * requests a day, and the default budget spends a fifth of that at most.
 *
 * Zero dependencies; Node runs the TypeScript directly. It writes nothing —
 * every request is a GET. The write path's proof is `scripts/stress.ts`.
 */

// ------------------------------------------------------------------- args --

interface Options {
  baseUrl: string;
  seconds: number;
  budget: number;
  json: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { baseUrl: "http://localhost:5173", seconds: 15, budget: 20000, json: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seconds" || arg === "--budget") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) fail(`${arg} needs a positive integer`);
      if (arg === "--seconds") options.seconds = value;
      else options.budget = value;
    } else if (arg === "--json") {
      options.json = argv[++i] ?? fail("--json needs a path");
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/loadtest.ts [baseUrl] [--seconds S] [--budget N] [--json out.json]");
      process.exit(0);
    } else if (arg.startsWith("--")) {
      fail(`unknown flag ${arg}`);
    } else {
      options.baseUrl = arg.replace(/\/$/, "");
    }
  }
  return options;
}

function fail(message: string): never {
  console.error(`loadtest: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- measure --

interface Sample {
  ms: number;
  status: number;
  bytes: number;
}

interface PhaseResult {
  name: string;
  path: string;
  concurrency: number;
  seconds: number;
  requests: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errors: number;
  statuses: Record<string, number>;
  avgBytes: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/**
 * Runs `concurrency` closed-loop workers for `seconds`, or until the shared
 * budget is spent. `next()` hands each worker its request; rotating ids and
 * players is the caller's business.
 */
async function phase(
  name: string,
  path: string,
  concurrency: number,
  seconds: number,
  budget: { left: number },
  next: () => { url: string; headers?: Record<string, string> },
): Promise<PhaseResult> {
  const samples: Sample[] = [];
  const deadline = performance.now() + seconds * 1000;
  const started = performance.now();

  async function worker(): Promise<void> {
    while (performance.now() < deadline && budget.left > 0) {
      budget.left--;
      const { url, headers } = next();
      const t0 = performance.now();
      try {
        const response = await fetch(url, { headers });
        const body = await response.arrayBuffer();
        samples.push({ ms: performance.now() - t0, status: response.status, bytes: body.byteLength });
      } catch {
        samples.push({ ms: performance.now() - t0, status: 0, bytes: 0 });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsed = (performance.now() - started) / 1000;
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const s of samples) statuses[s.status || "network"] = (statuses[s.status || "network"] ?? 0) + 1;
  const result: PhaseResult = {
    name,
    path,
    concurrency,
    seconds: elapsed,
    requests: samples.length,
    rps: samples.length / elapsed,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: percentile(sorted, 100),
    errors: samples.filter((s) => s.status === 0 || s.status >= 500).length,
    statuses,
    avgBytes: samples.reduce((a, s) => a + s.bytes, 0) / Math.max(1, samples.length),
  };
  console.log(
    `  ${name.padEnd(9)} c=${String(concurrency).padStart(3)}  ${String(result.requests).padStart(6)} req  ${result.rps.toFixed(0).padStart(5)} rps` +
      `  p50 ${result.p50.toFixed(0).padStart(4)}ms  p95 ${result.p95.toFixed(0).padStart(4)}ms  p99 ${result.p99.toFixed(0).padStart(4)}ms  max ${result.max.toFixed(0).padStart(5)}ms` +
      `  ${(result.avgBytes / 1024).toFixed(1).padStart(5)} KB  errors ${result.errors}`,
  );
  return result;
}

// ------------------------------------------------------------------- main --

interface User {
  id: string;
  role: string;
}
interface EventSummary {
  id: string;
}

function rotate<T>(items: T[]): () => T {
  let i = 0;
  return () => items[i++ % items.length]!;
}

async function main(): Promise<void> {
  const { baseUrl, seconds, budget: cap, json } = parseArgs(process.argv.slice(2));

  // Two hundred distinct players is enough rotation for the per-user phase;
  // the list endpoint is bounded and would not hand over 2,000 anyway.
  const users = (await (await fetch(`${baseUrl}/api/users?role=player&limit=200`)).json()) as User[];
  const players = users.map((u) => u.id);
  const events = (await (await fetch(`${baseUrl}/api/events`)).json()) as EventSummary[];
  if (players.length === 0 || events.length === 0) fail("need at least one player and one upcoming event");

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

  console.log(`\nGame Night load test`);
  console.log(`  target    ${baseUrl}`);
  console.log(`  players   ${players.length}   upcoming events ${events.length}`);
  console.log(`  phases    ${seconds}s each, ${cap} requests in total at most\n`);

  const player = rotate(players);
  const event = rotate(events.map((e) => e.id));
  const results: PhaseResult[] = [];
  // Five phases, an equal share each — otherwise the list phase, which is the
  // fastest, spends the whole budget before the spike gets a request.
  const share = () => ({ left: Math.floor(cap / 5) });
  const spent = () => cap - shares.reduce((a, s) => a + s.left, 0);
  const shares = [share(), share(), share(), share(), share()];

  results.push(await phase("list", "/api/events", 20, seconds, shares[0]!, () => ({ url: `${baseUrl}/api/events` })));
  results.push(
    await phase("calendar", "/api/events?from&to", 10, seconds, shares[1]!, () => ({
      url: `${baseUrl}/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    })),
  );
  results.push(await phase("detail", "/api/events/:id", 10, seconds, shares[2]!, () => ({ url: `${baseUrl}/api/events/${event()}` })));
  results.push(
    await phase("mine", "/api/me/rsvps", 10, seconds, shares[3]!, () => ({
      url: `${baseUrl}/api/me/rsvps`,
      headers: { "X-User-Id": player() },
    })),
  );
  // The event-day spike: five times the board's concurrency, for two thirds of a phase.
  results.push(await phase("spike", "/api/events", 100, Math.ceil(seconds * 0.66), shares[4]!, () => ({ url: `${baseUrl}/api/events` })));

  const total = results.reduce((a, r) => a + r.requests, 0);
  const errors = results.reduce((a, r) => a + r.errors, 0);
  console.log(`\n  ${total} requests, ${errors} errors, ${spent()} of ${cap} budget spent\n`);

  if (json) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(json, JSON.stringify({ baseUrl, at: new Date().toISOString(), players: players.length, events: events.length, results }, null, 2));
    console.log(`  wrote ${json}\n`);
  }
  if (errors > 0) process.exit(1);
}

void main();
