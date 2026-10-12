import { loadEnvFile } from "./load-env";
loadEnvFile();

// `--build`: runs inside `vercel-build` (first deploy + every deploy). Never fails the build; skips without a DB.
const BUILD = process.argv.includes("--build");
if (BUILD && (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("[SENSITIVE]"))) {
  console.log("scan:once --build: no DATABASE_URL, skipping");
  process.exit(0);
}
if (BUILD && process.env.SKIP_BUILD_SCAN === "1") {
  console.log("scan:once --build: SKIP_BUILD_SCAN=1");
  process.exit(0);
}
const { getRepo } = await import("../lib/db");
const { runLane, makeEngine } = await import("../lib/scheduler/lanes");
const { seedArtists, seedVenues, seedDemo } = await import("../lib/seed");

/**
 * `npm run scan:once`: a REAL live scan (all sources incl. grounded scout) against the configured database.
 * Seeds artists/venues/demo events if the DB is empty. Safe to re-run (idempotent).
 */
const repo = getRepo();
console.log(`repo: ${repo.kind}${repo.kind === "memory" ? " (no DATABASE_URL, results are not persisted)" : ""}`);
const seeded = await seedArtists(repo, { onlyIfEmpty: true });
if (seeded) console.log(`seeded ${seeded} artists`);
await seedVenues(repo);
if ((await repo.listEvents({ includeDemo: true })).filter((e) => e.is_demo).length === 0) {
  console.log(`seeded ${await seedDemo(await makeEngine(repo))} demo events`);
}
const lane = (["daily", "fast", "deep"].includes(process.argv[2]) ? process.argv[2] : "daily") as "daily" | "fast" | "deep";
const res = await runLane(repo, lane, { budgetMs: Number(process.env.SCAN_BUDGET_MS ?? (BUILD ? 180_000 : 600_000)) });
for (const l of res.log) console.log(l);
console.log(JSON.stringify({ lane: res.lane, status: res.status, stats: res.stats }, null, 2));
const events = await repo.listEvents({ includeDemo: false });
console.log(`real events in DB: ${events.length}`);
for (const e of events.slice(0, 20)) console.log(`  ${e.start_date_local ?? "TBA"}  ${e.city.padEnd(10)} ${e.confidence.padEnd(11)} ${e.title}`);
process.exit(res.status === "error" && !BUILD ? 1 : 0);
