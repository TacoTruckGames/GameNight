#!/usr/bin/env node
/**
 * Game Night — RSVP stress check.
 *
 *   node scripts/stress.ts [baseUrl] [--players N] [--capacity C]
 *
 * Defaults: `http://localhost:5173`, 40 players, capacity 5.
 *
 * This is the real-HTTP version of `test/concurrency/`. The vitest suite proves
 * S1/S2 inside workerd; this proves the same two claims across the wire against
 * a running server — `pnpm dev` locally, or the deployed URL:
 *
 *   node scripts/stress.ts https://gamenight.tacotruckgames.com --players 40
 *
 * It does two things and checks them exactly:
 *
 *   1. N brand-new players PUT their RSVP to one capacity-C event, all at once.
 *      Exactly min(N, C) must be confirmed — not "at most". Losing an RSVP is
 *      as much a bug as over-booking one.
 *   2. One player who already holds a seat PUTs 20 more times, all at once.
 *      Nothing may change: same attendee count, no second row, no 409.
 *
 * Zero dependencies; Node runs the TypeScript directly. Exits 1 on any
 * violation so it can gate a deploy.
 *
 * Note: it creates a `[stress] …` event and N throwaway players. `pnpm dev`
 * re-seeds on every start, and `pnpm db:seed:remote` wipes the remote board,
 * so cleanup is whichever of those you were going to run anyway.
 */

// ------------------------------------------------------------------- args --

interface Options {
  baseUrl: string;
  players: number;
  capacity: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { baseUrl: "http://localhost:5173", players: 40, capacity: 5 };
  let sawUrl = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--players" || arg === "--capacity") {
      const raw = argv[i + 1];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        fail(`${arg} needs a positive whole number, got ${JSON.stringify(raw)}`);
      }
      if (arg === "--players") options.players = value;
      else options.capacity = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/stress.ts [baseUrl] [--players N] [--capacity C]");
      process.exit(0);
    } else if (arg !== undefined && arg.startsWith("-")) {
      fail(`unknown flag ${arg}`);
    } else if (arg !== undefined && !sawUrl) {
      options.baseUrl = arg.replace(/\/$/, "");
      sawUrl = true;
    } else {
      fail(`unexpected argument ${String(arg)}`);
    }
  }

  if (options.capacity > 500) fail("--capacity must be 500 or less (the API rejects more)");
  return options;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------- http --

interface Reply<T> {
  status: number;
  body: T;
}

let baseUrl = "";

async function request<T>(path: string, init: { method?: string; as?: string; body?: unknown } = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (init.as !== undefined) headers["X-User-Id"] = init.as;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    fail(`could not reach ${baseUrl}${path} — is the server running?\n  ${String(error)}`);
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* keep the raw text so the error message is useful */
  }
  return { status: response.status, body: body as T };
}

function expectStatus<T>(reply: Reply<T>, status: number, what: string): T {
  if (reply.status !== status) {
    fail(`${what}: expected HTTP ${status}, got ${reply.status}\n  ${JSON.stringify(reply.body)}`);
  }
  return reply.body;
}

// ---------------------------------------------------------------- reports --

function tally(statuses: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return new Map([...counts].sort((a, b) => a[0] - b[0]));
}

function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  const line = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  const [header, ...body] = rows;
  const rule = widths.map((width) => "─".repeat(width)).join("  ");
  return [line(header ?? []), rule, ...body.map(line)].join("\n");
}

const problems: string[] = [];

function check(label: string, actual: unknown, expected: unknown): string[] {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) problems.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return [ok ? "PASS" : "FAIL", label, JSON.stringify(actual), JSON.stringify(expected)];
}

// ------------------------------------------------------------------- main --

interface User {
  id: string;
  name: string;
  role: string;
}

interface EventSummary {
  id: string;
  title: string;
  capacity: number;
  attendeeCount: number;
  seatsLeft: number;
  isFull: boolean;
}

interface RsvpResponse {
  status: string;
  attendeeCount: number;
  capacity: number;
  seatsLeft: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  baseUrl = options.baseUrl;
  const { players, capacity } = options;
  const expectedSeats = Math.min(players, capacity);

  console.log(`\nGame Night stress check`);
  console.log(`  target    ${baseUrl}`);
  console.log(`  players   ${players}`);
  console.log(`  capacity  ${capacity}\n`);

  // -- setup -----------------------------------------------------------------
  // Organizers are seed-only, so borrow one rather than inventing one.
  const [organizer] = expectStatus(await request<User[]>("/api/users?role=organizer&limit=1"), 200, "GET /api/users");
  if (!organizer) fail("no organizer in /api/users — seed the database first (pnpm db:reset:local)");

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const event = expectStatus(
    await request<EventSummary>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: {
        title: `[stress] ${new Date().toISOString().slice(0, 19)}Z`,
        gameType: "other",
        startsAt,
        location: "Stress Test Lab",
        capacity,
      },
    }),
    201,
    "POST /api/events",
  );
  console.log(`  event     ${event.id}  "${event.title}"`);

  const roster = await Promise.all(
    Array.from({ length: players }, (_value, index) =>
      request<User>("/api/users", { method: "POST", body: { name: `Stress ${index + 1}` } }).then((reply) =>
        expectStatus(reply, 201, "POST /api/users"),
      ),
    ),
  );
  console.log(`  players   created ${roster.length}\n`);

  // -- 1. the race -----------------------------------------------------------
  const startedAt = Date.now();
  const race = await Promise.all(
    roster.map((player) => request<RsvpResponse>(`/api/events/${event.id}/rsvp`, { method: "PUT", as: player.id })),
  );
  const elapsed = Date.now() - startedAt;

  const raceTally = tally(race.map((reply) => reply.status));
  const confirmed = race.filter((reply) => reply.status === 201);
  const rejected = race.filter((reply) => reply.status === 409);

  const afterRace = expectStatus(
    await request<EventSummary>(`/api/events/${event.id}`),
    200,
    `GET /api/events/${event.id}`,
  );

  const rows: string[][] = [["", "check", "actual", "expected"]];
  rows.push(check("confirmed (201)", confirmed.length, expectedSeats));
  rows.push(check("full (409)", rejected.length, players - expectedSeats));
  rows.push(check("no other status", [...raceTally.keys()].filter((s) => s !== 201 && s !== 409), []));
  rows.push(check("attendeeCount", afterRace.attendeeCount, expectedSeats));
  rows.push(check("seatsLeft", afterRace.seatsLeft, capacity - expectedSeats));
  rows.push(check("isFull", afterRace.isFull, expectedSeats >= capacity));
  rows.push(
    check(
      "every 409 is EVENT_FULL",
      rejected.every((reply) => (reply.body as unknown as { error?: { code?: string } }).error?.code === "EVENT_FULL"),
      true,
    ),
  );

  // -- 2. the retry storm ----------------------------------------------------
  // A player who already holds a seat hammers PUT. Idempotent by contract, so
  // every reply must say "you are in" and nothing may move.
  const seated = confirmed.length > 0 ? roster[race.indexOf(confirmed[0]!)]! : roster[0]!;
  const retries = await Promise.all(
    Array.from({ length: 20 }, () =>
      request<RsvpResponse>(`/api/events/${event.id}/rsvp`, { method: "PUT", as: seated.id }),
    ),
  );
  const retryTally = tally(retries.map((reply) => reply.status));
  const afterRetries = expectStatus(
    await request<EventSummary>(`/api/events/${event.id}`),
    200,
    `GET /api/events/${event.id}`,
  );

  rows.push(check("retries all 200", retries.filter((reply) => reply.status === 200).length, 20));
  rows.push(
    check(
      "retries all already_confirmed",
      retries.every((reply) => reply.body.status === "already_confirmed"),
      true,
    ),
  );
  rows.push(check("attendeeCount unchanged", afterRetries.attendeeCount, expectedSeats));

  // -- report ----------------------------------------------------------------
  console.log(table(rows));
  console.log(`\n  race statuses    ${[...raceTally].map(([s, n]) => `${s}×${n}`).join("  ")}   (${elapsed} ms)`);
  console.log(`  retry statuses   ${[...retryTally].map(([s, n]) => `${s}×${n}`).join("  ")}`);

  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} violation${problems.length === 1 ? "" : "s"}:`);
    for (const problem of problems) console.error(`    ${problem}`);
    console.error("");
    process.exit(1);
  }

  console.log(`\n✓ no over-booking, no duplicates, no lost RSVPs — ${expectedSeats}/${capacity} seats taken.\n`);
}

await main();
