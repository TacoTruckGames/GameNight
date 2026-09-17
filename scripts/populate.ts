#!/usr/bin/env node
/**
 * Game Night — bring the board up to launch scale.
 *
 *   node scripts/populate.ts [baseUrl] [--players 2000] [--concurrency 12]
 *
 * Registers players through the public signup path (`POST /api/users`) until
 * the board holds `--players` of them, so the number is a *target*, not an
 * increment: run it twice and the second run does nothing. The brief's launch
 * column is ~2,000 registered players; that is the default.
 *
 * Through the API, not SQL, on purpose. It is the same call a phone makes, so
 * it exercises the same validation, the same id shape and the same insert —
 * and a couple of thousand of them in a row is a small, honest load test of the
 * signup route that a SQL `INSERT` would tell you nothing about.
 *
 * Names are generated from two lists with a seeded PRNG, so the same target
 * produces the same people every time (the seed is the target count), and no
 * two generated players share a name. Zero dependencies; Node runs the
 * TypeScript directly.
 *
 * Against production this writes real rows. It never deletes anything.
 */

// ------------------------------------------------------------------- args --

interface Options {
  baseUrl: string;
  players: number;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { baseUrl: "http://localhost:5173", players: 2000, concurrency: 12 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--players" || arg === "--concurrency") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) fail(`${arg} needs a positive integer`);
      if (arg === "--players") options.players = value;
      else options.concurrency = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/populate.ts [baseUrl] [--players N] [--concurrency C]");
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
  console.error(`populate: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------ names --

const FIRST = [
  "Ada", "Amir", "Anya", "Beck", "Bo", "Cal", "Cass", "Chen", "Dev", "Dimitri", "Eden", "Elif", "Emeka", "Esme",
  "Farah", "Finn", "Gita", "Hana", "Hugo", "Ines", "Ivo", "Jae", "Juno", "Kai", "Kira", "Lars", "Leila", "Luca",
  "Mabel", "Malik", "Mara", "Mateo", "Mika", "Nadia", "Nico", "Nia", "Odile", "Omar", "Oren", "Petra", "Pilar",
  "Quinn", "Rafael", "Ravi", "Remy", "Rosa", "Sable", "Sana", "Sasha", "Sol", "Tamsin", "Teo", "Thea", "Tomas",
  "Uma", "Vera", "Wes", "Xan", "Yara", "Yusuf", "Zara", "Zev",
];
const LAST = [
  "Abara", "Achebe", "Adler", "Alvarez", "Baptiste", "Bergström", "Bianchi", "Calloway", "Castillo", "Chen",
  "Dagher", "Delgado", "Dubois", "Eriksen", "Farouk", "Ferreira", "Fischer", "Gallo", "Haddad", "Halvorsen",
  "Ibarra", "Ishikawa", "Jansen", "Joshi", "Kaur", "Kimura", "Kowalski", "Lindqvist", "Lopes", "Maalouf",
  "Mendes", "Moreau", "Nakamura", "Novak", "Okafor", "Oyelaran", "Park", "Pereira", "Quiroga", "Rahman",
  "Reyes", "Rossi", "Saito", "Sandoval", "Schmidt", "Silva", "Tanaka", "Thorne", "Uribe", "Varga", "Vieira",
  "Walsh", "Weber", "Yamamoto", "Yilmaz", "Zhang", "Zielinski",
];

/** mulberry32 — small, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every first × last pair once, in a seeded order, with an initial for overflow. */
function* names(seed: number, taken: Set<string>): Generator<string> {
  const rand = prng(seed);
  const pairs: string[] = [];
  for (const first of FIRST) for (const last of LAST) pairs.push(`${first} ${last}`);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
  }
  for (const name of pairs) if (!taken.has(name)) yield name;
  // 3,500+ pairs is plenty for 2,000; past that, disambiguate with an initial.
  for (const initial of "ABCDEFGHJKLMNPRSTVW") for (const name of pairs) {
    const [first, last] = name.split(" ");
    const candidate = `${first} ${initial}. ${last}`;
    if (!taken.has(candidate)) yield candidate;
  }
}

// ------------------------------------------------------------------- http --

interface User {
  id: string;
  name: string;
  role: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function register(baseUrl: string, name: string): Promise<{ ms: number; status: number }> {
  const started = performance.now();
  let status = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role: "player" }),
      });
      status = response.status;
      await response.arrayBuffer();
      if (status === 201) break;
      if (status < 500 && status !== 429) break; // a 4xx is not going to improve
    } catch {
      status = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  return { ms: performance.now() - started, status };
}

// ------------------------------------------------------------------- main --

/**
 * How many players the board holds. `GET /api/users` is bounded (it is a
 * picker), so the count comes from the operator overview, as the operator.
 */
async function countPlayers(baseUrl: string): Promise<number> {
  const [operator] = (await (await fetch(`${baseUrl}/api/users?role=admin&limit=1`)).json()) as User[];
  if (!operator) fail("no operator account — seed the database first");
  const overview = (await (
    await fetch(`${baseUrl}/api/admin/overview`, { headers: { "X-User-Id": operator.id } })
  ).json()) as { users: { players: number } };
  return overview.users.players;
}

async function main(): Promise<void> {
  const { baseUrl, players, concurrency } = parseArgs(process.argv.slice(2));

  const current = await countPlayers(baseUrl);
  const need = players - current;

  console.log(`\nGame Night populate`);
  console.log(`  target       ${baseUrl}`);
  console.log(`  players now  ${current}`);
  console.log(`  target       ${players}`);
  if (need <= 0) {
    console.log(`\nNothing to do — the board already holds ${current} players.\n`);
    return;
  }
  console.log(`  to register  ${need}  (concurrency ${concurrency})\n`);

  // The first two hundred names are the ones worth not colliding with — the
  // seeded personas; a generated name that repeats a generated name is caught
  // by the generator itself, which never yields a pair twice.
  const existing = (await (await fetch(`${baseUrl}/api/users?limit=200`)).json()) as User[];
  const taken = new Set(existing.map((user) => user.name));
  const queue = names(players, taken);
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let created = 0;
  let dispatched = 0;
  const started = performance.now();

  async function worker(): Promise<void> {
    while (dispatched < need) {
      dispatched++;
      const next = queue.next();
      if (next.done) fail("ran out of names");
      const { ms, status } = await register(baseUrl, next.value);
      latencies.push(ms);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
      if (status === 201) created++;
      if ((created + 0) % 250 === 0 && status === 201) {
        process.stdout.write(`  ${created} registered…\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const seconds = (performance.now() - started) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = await countPlayers(baseUrl);

  console.log(`\n  registered   ${created} of ${need} in ${seconds.toFixed(1)}s  (${(created / seconds).toFixed(1)} signups/s)`);
  console.log(`  latency      p50 ${percentile(sorted, 50).toFixed(0)}ms  p95 ${percentile(sorted, 95).toFixed(0)}ms  p99 ${percentile(sorted, 99).toFixed(0)}ms  max ${percentile(sorted, 100).toFixed(0)}ms`);
  console.log(`  statuses     ${[...statuses.entries()].map(([code, n]) => `${code || "network"}×${n}`).join("  ")}`);
  console.log(`  players now  ${total}\n`);
  if (total < players) fail(`board holds ${total} players, wanted ${players}`);
}

void main();
