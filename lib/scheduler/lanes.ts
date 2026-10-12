import { randomUUID } from "node:crypto";
import { env } from "@/lib/config/env";
import { Gemini } from "@/lib/ai/gemini";
import type { Repo } from "@/lib/db/repo";
import type { SourceHealth } from "@/lib/domain/types";
import type { Channels } from "@/lib/notify/dispatch";
import { EmailNotifier, MockNotifier, TelegramNotifier } from "@/lib/notify/notifiers";
import { Engine } from "@/lib/pipeline/engine";
import { BlockedError, PoliteHttp, type Http } from "@/lib/sources/http";
import { alleventsAdapter } from "@/lib/sources/adapters/allevents";
import { districtAdapter } from "@/lib/sources/adapters/district";
import { bingNewsAdapter, googleNewsAdapter } from "@/lib/sources/adapters/news";
import { makeScoutAdapter } from "@/lib/sources/adapters/scout";
import { skillboxAdapter } from "@/lib/sources/adapters/skillbox";
import { STATIC_SOURCES } from "@/lib/sources/registry";
import { PIPELINE_VERSION } from "@/lib/sources/adapters/common";
import { DISTRICT_INDEX } from "@/lib/sources/adapters/district";
import { SKILLBOX_SITEMAP } from "@/lib/sources/adapters/skillbox";
import type { Lane, SourceAdapter } from "@/lib/sources/types";

export interface LaneResult {
  lane: Lane;
  status: "ok" | "partial" | "error" | "skipped";
  stats: Record<string, unknown>;
  log: string[];
}

export function defaultChannels(): Channels {
  return { primary: [new TelegramNotifier(), new EmailNotifier()], mock: new MockNotifier() };
}

export async function makeEngine(repo: Repo, opts: { channels?: Channels; gemini?: Gemini; log?: (m: string) => void; now?: () => Date } = {}) {
  const e = env();
  const engine = new Engine(repo, opts.gemini ?? Gemini.fromEnv(repo), opts.channels ?? defaultChannels(), {
    homeCity: e.HOME_CITY, appBaseUrl: e.APP_BASE_URL, log: opts.log, now: opts.now,
  });
  return engine.refresh();
}

/** Run one adapter with health bookkeeping: blocked → degraded for 6h; 3 consecutive errors → degraded 1h. */
export async function runAdapter(repo: Repo, a: SourceAdapter, engine: Engine, http: Http, lane: Lane, deadline: number, log: (m: string) => void) {
  const now = new Date();
  const h: SourceHealth = (await repo.getHealth(a.id)) ?? {
    source_id: a.id, status: "ok", last_run_at: null, last_ok_at: null, last_error_at: null, last_error: null, consecutive_failures: 0, degraded_until: null, items_last_run: 0,
  };
  const disabled = a.disabledReason(env());
  if (disabled) {
    await repo.setHealth({ ...h, status: disabled.startsWith("grounding") ? "no_grounding" : "disabled", last_error: disabled, last_run_at: now.toISOString() });
    return { id: a.id, skipped: disabled, items: 0, results: [] as Awaited<ReturnType<Engine["ingest"]>>[] };
  }
  if (h.degraded_until && Date.parse(h.degraded_until) > now.getTime() && lane !== "manual") {
    return { id: a.id, skipped: `degraded until ${h.degraded_until}`, items: 0, results: [] };
  }
  try {
    const items = await a.fetchNew({ repo, http, matcher: engine.matcher, artists: engine.artists, now, lane, deadline, log });
    const results = [];
    for (const o of items) results.push(await engine.ingest(o));
    await repo.setHealth({ ...h, status: "ok", last_run_at: now.toISOString(), last_ok_at: new Date().toISOString(), consecutive_failures: 0, degraded_until: null, items_last_run: items.length, last_error: null });
    return { id: a.id, skipped: null, items: items.length, results };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    const blocked = e instanceof BlockedError || (e as Error).name === "BlockedError";
    const noGrounding = msg.startsWith("no_grounding");
    const fails = h.consecutive_failures + 1;
    await repo.setHealth({
      ...h, status: noGrounding ? "no_grounding" : blocked ? "blocked" : fails >= 3 ? "degraded" : h.status, last_run_at: now.toISOString(), last_error_at: now.toISOString(),
      last_error: msg, consecutive_failures: fails, items_last_run: 0,
      degraded_until: blocked ? new Date(now.getTime() + 6 * 3_600_000).toISOString() : fails >= 3 ? new Date(now.getTime() + 3_600_000).toISOString() : null,
    });
    log(`${a.id}: ${msg}`);
    return { id: a.id, skipped: null, error: msg, items: 0, results: [] };
  }
}

/**
 * Lanes (all idempotent, lease-locked, deadline-bounded, cursor-resumed):
 *  fast  (every 5 min, external scheduler): listing pages, sitemaps, news RSS, reminders, quiet-hour flush.
 *  deep  (every 30 min, external scheduler): grounded Gemini scout over artists by priority × staleness.
 *  daily (Vercel Cron 03:30 UTC ≈ 09:00 IST): full sweep, Spotify re-sync, digest/heartbeat, pruning.
 */
export async function runLane(repo: Repo, lane: Lane, opts: { budgetMs?: number; http?: Http; engine?: Engine; channels?: Channels } = {}): Promise<LaneResult> {
  const log: string[] = [];
  const say = (m: string) => { log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); };
  const holder = randomUUID();
  const lockName = `lane:${lane === "manual" ? "fast" : lane}`;
  const ttl = Math.ceil((opts.budgetMs ?? 270_000) / 1000) + 30;
  if (!(await repo.acquireLock(lockName, holder, ttl))) return { lane, status: "skipped", stats: { reason: "another run holds the lock" }, log };
  const run = await repo.startRun(lane);
  const deadline = Date.now() + (opts.budgetMs ?? 270_000);
  const stats: Record<string, unknown> = {};
  try {
    for (const s of STATIC_SOURCES) await repo.upsertSource(s);
    if ((await repo.getKv<string>("pipeline:version")) !== PIPELINE_VERSION) {
      // New parsing logic: forget sitemap cursors and ETags so every matching page is re-read once.
      for (const k of ["district:matched", "skillbox:matched"]) await repo.setKv(k, {});
      for (const u of [DISTRICT_INDEX, "https://cdn.district.in/sitemap/event-detail-pages.xml", SKILLBOX_SITEMAP]) {
        await repo.setHttpCache({ url: u, etag: null, last_modified: null, content_hash: null, fetched_at: new Date().toISOString() });
      }
      await repo.setKv("pipeline:version", PIPELINE_VERSION);
      say(`pipeline version → ${PIPELINE_VERSION}: re-reading sources`);
    }
    const engine = opts.engine ?? (await makeEngine(repo, { log: say, channels: opts.channels }));
    const http = opts.http ?? new PoliteHttp(repo);
    const settings = engine.settings;
    const scout = makeScoutAdapter(engine.gemini, () => settings, Number(process.env.SCOUT_CALLS_PER_RUN ?? 3));
    const fast: SourceAdapter[] = [districtAdapter, skillboxAdapter, alleventsAdapter, bingNewsAdapter, googleNewsAdapter];
    const adapters = lane === "fast" ? fast : lane === "deep" ? [scout] : [...fast, scout];
    const perAdapter: Record<string, unknown> = {};
    for (const a of adapters) {
      if (Date.now() > deadline - 10_000) { perAdapter[a.id] = "deferred (time budget)"; continue; }
      const r = await runAdapter(repo, a, engine, http, lane, deadline, say);
      perAdapter[a.id] = r.skipped ? `skipped: ${r.skipped}` : (r as { error?: string }).error ? `error: ${(r as { error?: string }).error}` : `${r.items} items`;
    }
    for (const w of scout.lastWhispers) await engine.ingestWhisper(w.o, w.artist_id);
    stats.adapters = perAdapter;
    if (lane !== "deep") {
      stats.reminders = await engine.dispatchReminders();
      stats.heldFlushed = await engine.flushHeld();
    }
    Object.assign(stats, engine.stats);
    const partial = Object.values(perAdapter).some((v) => String(v).startsWith("error"));
    await repo.finishRun(run.id, partial ? "partial" : "ok", { ...stats, log: log.slice(-40) });
    await repo.setKv("heartbeat", { at: new Date().toISOString(), lane });
    return { lane, status: partial ? "partial" : "ok", stats, log };
  } catch (e) {
    await repo.finishRun(run.id, "error", { ...stats, log: log.slice(-40) }, (e as Error).message);
    return { lane, status: "error", stats: { ...stats, error: (e as Error).message }, log };
  } finally {
    await repo.releaseLock(lockName, holder);
  }
}
