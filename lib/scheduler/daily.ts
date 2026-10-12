import type { Repo } from "@/lib/db/repo";
import { syncSpotify } from "@/lib/spotify/spotify";
import { seedArtists, seedVenues } from "@/lib/seed";
import { utcToIstDate } from "@/lib/text/dates-ist";
import { deliver } from "@/lib/notify/dispatch";
import { makeEngine, runLane } from "./lanes";

/**
 * Daily lane (Vercel Cron, 03:30 UTC ≈ 09:00 IST): Spotify re-sync, venue refresh, full sweep,
 * digest + heartbeat ("Checked N artists across M sources, no new shows"), pruning.
 */
export async function runDaily(repo: Repo) {
  const out: Record<string, unknown> = {};
  try { out.spotify = (await syncSpotify(repo)) ?? "not connected"; } catch (e) { out.spotify = `error: ${(e as Error).message}`; }
  out.seeded = await seedArtists(repo, { onlyIfEmpty: true });
  out.venues = await seedVenues(repo);
  const sweep = await runLane(repo, "daily", { budgetMs: 200_000 });
  out.sweep = { status: sweep.status, adapters: sweep.stats.adapters };

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const runs = (await repo.listRuns(400)).filter((r) => r.started_at >= since);
  const artists = (await repo.listArtists()).filter((a) => a.enabled);
  const health = await repo.listHealth();
  const okSources = health.filter((h) => h.status === "ok").length;
  const newEvents = (await repo.listEvents({ includeDemo: false })).filter((e) => e.first_seen_at >= since);
  const lines = [
    `Checked ${artists.length} artists across ${okSources} healthy sources in ${runs.length} scans (last 24h).`,
    newEvents.length ? `${newEvents.length} new show(s): ${newEvents.slice(0, 8).map((e) => `${e.title} (${e.city}, ${e.start_date_local ?? "date TBA"})`).join("; ")}` : "No new shows. No alert means no show found, not that nothing was checked.",
    `Degraded/blocked sources: ${health.filter((h) => h.status !== "ok").map((h) => `${h.source_id}=${h.status}`).join(", ") || "none"}`,
  ];
  const engine = await makeEngine(repo);
  const alert = await repo.insertAlertIfNew({
    event_id: null, type: "DIGEST", dedupe_key: `digest|${utcToIstDate(new Date().toISOString())}`, priority: "P2", payload: { lines },
    text: lines.join("\n"), is_demo: false, held_for_quiet: false, first_public_at: null, first_seen_at: null, sent_at: null,
  });
  if (alert) {
    const title = "Live Show Radar: daily digest";
    out.digest = await deliver(repo, engine.channels, { ...alert, priority: "P1" }, {
      title, lines, html: `<b>${title}</b>\n${lines.join("\n")}`, text: `${title}\n${lines.join("\n")}`, ticketUrl: null, eventUrl: `${engine.opts.appBaseUrl}/health`, unconfirmed: false,
    }, { settings: engine.settings, now: new Date(), urgency: 0, icsUrl: null });
  }
  out.pruned = await repo.prune(new Date(Date.now() - 30 * 86_400_000).toISOString());
  await repo.setKv("heartbeat", { at: new Date().toISOString(), lane: "daily" });
  return out;
}
