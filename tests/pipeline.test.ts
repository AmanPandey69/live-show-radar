import { beforeEach, describe, expect, it } from "vitest";
import { decideAlerts } from "@/lib/alerts/decide";
import { planReminders } from "@/lib/alerts/reminders";
import { buildIcs } from "@/lib/alerts/ics";
import { ticketStatusLine } from "@/lib/alerts/render";
import { Gemini, HttpStatusError, type Transport } from "@/lib/ai/gemini";
import { MemoryRepo } from "@/lib/db/memory";
import type { EventRow, TicketTier } from "@/lib/domain/types";
import { MockNotifier } from "@/lib/notify/notifiers";
import { Engine } from "@/lib/pipeline/engine";
import { runAdapter } from "@/lib/scheduler/lanes";
import { districtAdapter, DISTRICT_INDEX } from "@/lib/sources/adapters/district";
import { bingNewsAdapter } from "@/lib/sources/adapters/news";
import { FixtureHttp } from "@/lib/sources/http";
import { seedArtists } from "@/lib/seed";

const NOW = new Date("2026-10-12T06:00:00Z");
const PAPON = "https://www.district.in/events/papon-live-in-concert-bengaluru-2026-buy-tickets";

async function setup(transport?: Transport) {
  const repo = new MemoryRepo();
  await seedArtists(repo);
  const gemini = new Gemini(repo, { model: "google/gemini-3.8-flash", dailyCalls: 50, dailyGrounded: 10, groundingEnabled: true, transport, sleep: async () => {} });
  const mock = new MockNotifier();
  const engine = await new Engine(repo, gemini, { primary: [], mock }, { homeCity: "Bengaluru", appBaseUrl: "https://example.test", now: () => NOW }).refresh();
  return { repo, engine, mock };
}

const http = new FixtureHttp({
  [DISTRICT_INDEX]: "rss/district-event-sitemap-index.xml",
  "https://cdn.district.in/sitemap/event-detail-pages.xml": "rss/district-event-sitemap.xml",
  [PAPON]: "pages/district-papon-bengaluru.html",
});

describe("fixture replay: District sitemap → JSON-LD → event → alert", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  it("produces the Papon Bengaluru event with an early-bird NEW_SHOW alert (mock channel)", async () => {
    const r = await runAdapter(ctx.repo, districtAdapter, ctx.engine, http, "replay", Date.now() + 60_000, () => {});
    expect(r.items).toBeGreaterThan(0);
    const events = await ctx.repo.listEvents({});
    const papon = events.find((e) => e.title === "Papon Live In Concert | Bengaluru")!;
    expect(papon).toMatchObject({ city: "Bengaluru", start_date_local: "2026-11-14", confidence: "confirmed", status: "early_bird", priority: "P0" });
    const alerts = await ctx.repo.listAlerts({ eventId: papon.id });
    expect(alerts.map((a) => a.type)).toContain("NEW_SHOW");
    expect(ctx.mock.sent.some((m) => m.rendered.lines.some((l) => l.includes("EARLY-BIRD OPEN NOW")))).toBe(true);
    // Deadline must NOT be invented from availabilityEnds = show start.
    expect(ctx.mock.sent[0].rendered.lines.find((l) => l.startsWith("Tickets:"))).toMatch(/deadline not stated/);
  });

  it("is idempotent: replaying the same pages creates no duplicate events or alerts", async () => {
    await runAdapter(ctx.repo, districtAdapter, ctx.engine, http, "replay", Date.now() + 60_000, () => {});
    const e1 = (await ctx.repo.listEvents({})).length;
    const a1 = (await ctx.repo.listAlerts({})).length;
    await ctx.repo.setKv("district:matched", {}); // force re-fetch
    await runAdapter(ctx.repo, districtAdapter, ctx.engine, http, "replay", Date.now() + 60_000, () => {});
    expect((await ctx.repo.listEvents({})).length).toBe(e1);
    expect((await ctx.repo.listAlerts({})).length).toBe(a1);
  });

  it("merges a news mention into the same event as a second source", async () => {
    await runAdapter(ctx.repo, districtAdapter, ctx.engine, http, "replay", Date.now() + 60_000, () => {});
    const text = "Papon Live In Concert in Bengaluru on 14 November 2026 at District Arena @ Terraform, Yelahanka. Show at 7 PM.";
    const r = await ctx.engine.ingest({ source_id: "bing-news", url: "https://example-news.test/papon", fetched_at: NOW.toISOString(), published_at: "2026-10-12T05:00:00Z", content_hash: "h1", title: "Papon to perform in Bengaluru", text, snippet: text, candidate: null, is_primary: false });
    expect(r.status).toBe("merged");
    const events = (await ctx.repo.listEvents({})).filter((e) => e.city === "Bengaluru" && e.title.includes("Papon"));
    expect(events).toHaveLength(1);
    expect(await ctx.repo.listEventSources([events[0].id])).toHaveLength(2);
  });
});

describe("Gemini 429 storm", () => {
  it("never stops ingestion: falls back to deterministic extraction and records rate limiting", async () => {
    let calls = 0;
    const storm: Transport = async () => { calls++; throw new HttpStatusError(429, "RESOURCE_EXHAUSTED"); };
    const { repo, engine } = await setup(storm);
    const text = "The Local Train announce Bengaluru show at Phoenix Marketcity on 21 November 2026. Early bird tickets live now, limited quantity.";
    const r = await engine.ingest({ source_id: "bing-news", url: "https://example-news.test/ltr", fetched_at: NOW.toISOString(), published_at: null, content_hash: "storm1", title: "The Local Train Bengaluru", text, snippet: text, candidate: null, is_primary: false });
    expect(r.status).toBe("merged");
    expect(engine.stats.fallbacks).toBe(1);
    expect(calls).toBe(4); // 1 try + 3 backoff retries, then cooldown
    const usage = await repo.listGeminiUsage("2000-01-01");
    expect(usage.some((u) => u.status === "rate_limited")).toBe(true);
    // Second item during cooldown: no further API calls, still ingested.
    const text2 = "Prateek Kuhad live in Mumbai on 5 December 2026 at NSCI Dome.";
    const r2 = await engine.ingest({ source_id: "bing-news", url: "https://example-news.test/pk", fetched_at: NOW.toISOString(), published_at: null, content_hash: "storm2", title: "Prateek Kuhad Mumbai", text: text2, snippet: text2, candidate: null, is_primary: false });
    expect(r2.status).toBe("merged");
    expect(calls).toBe(4);
  });
});

describe("news adapter through the pipeline (synthetic Bing fixture)", () => {
  it("creates an unconfirmed Local Train event and ignores the tribute night", async () => {
    const { repo, engine } = await setup();
    await repo.updateArtist((await repo.listArtists()).find((a) => a.name === "The Local Train")!.id, { affinity: "must_see" });
    await engine.refresh();
    const fx = new FixtureHttp(new Proxy({}, { get: () => "rss/bing-news-SYNTHETIC.xml" }) as Record<string, string>);
    await runAdapter(repo, bingNewsAdapter, engine, fx, "replay", Date.now() + 60_000, () => {});
    const events = await repo.listEvents({});
    const ltr = events.filter((e) => e.title.toLowerCase().includes("local train"));
    expect(ltr).toHaveLength(1);
    expect(ltr[0]).toMatchObject({ city: "Bengaluru", start_date_local: "2026-11-21", confidence: "unconfirmed" });
    expect(events.some((e) => /tribute/i.test(e.title))).toBe(false);
  });
});

describe("alert facts, dedupe keys and reminders", () => {
  const ev = { id: "e1", city: "Bengaluru", status: "announced", confidence: "confirmed", start_date_local: "2026-11-21", start_at: "2026-11-21T14:00:00Z", venue_name_raw: "Fandom", priority: "P0" } as EventRow;
  const tier = (o: Partial<TicketTier>): TicketTier => ({ id: "t1", event_id: "e1", tier_type: "early_bird", name_raw: "Early Bird", price_inr_min: null, price_inr_max: null, sale_start_at: null, sale_end_at: null, quantity_note: null, availability: "unknown", source_url: null, evidence_snippet: "x", field_confidence: "confirmed", updated_at: "", ...o });

  it("NEW_SHOW once; EB_OPEN only on transition; CHANGED on venue change", () => {
    const a = decideAlerts(null, { event: ev, tiers: [] }, NOW);
    expect(a.map((f) => f.type)).toEqual(["NEW_SHOW"]);
    const b = decideAlerts({ event: ev, tiers: [tier({ availability: "upcoming", sale_start_at: "2026-10-17T04:30:00Z" })] }, { event: ev, tiers: [tier({ availability: "open" })] }, NOW);
    expect(b.map((f) => f.type)).toContain("EARLY_BIRD_OPEN");
    const c = decideAlerts({ event: ev, tiers: [tier({ availability: "open" })] }, { event: ev, tiers: [tier({ availability: "open" })] }, NOW);
    expect(c).toEqual([]);
    const d = decideAlerts({ event: ev, tiers: [] }, { event: { ...ev, venue_name_raw: "Palace Grounds" }, tiers: [] }, NOW);
    expect(d[0]).toMatchObject({ type: "CHANGED", key: "e1|CHANGED|venue|palace grounds" });
    const e = decideAlerts({ event: ev, tiers: [] }, { event: { ...ev, status: "cancelled" }, tiers: [] }, NOW);
    expect(e[0].type).toBe("CANCELLED");
  });

  it("imminent + closing alerts carry the time in the dedupe key", () => {
    const f = decideAlerts({ event: ev, tiers: [] }, { event: ev, tiers: [tier({ availability: "upcoming", sale_start_at: "2026-10-17T04:30:00Z" })] }, NOW);
    expect(f[0]).toMatchObject({ type: "EARLY_BIRD_IMMINENT", key: "e1|EB_IMMINENT|early_bird:early bird|2026-10-17T04:30:00Z" });
  });

  it("schedules T-24h/T-1h/T-10m before a known opening, skipping past offsets", () => {
    const plan = planReminders(ev, [tier({ availability: "upcoming", sale_start_at: "2026-10-12T06:30:00Z" })], NOW);
    expect(plan.map((p) => p.offset_label)).toEqual(["T-10m"]);
    const plan2 = planReminders(ev, [tier({ availability: "open", sale_end_at: "2026-10-15T18:29:00Z" })], NOW);
    expect(plan2.map((p) => `${p.kind}:${p.offset_label}`)).toEqual(["sale_close:T-24h", "sale_close:T-1h", "sale_close:T-10m"]);
  });

  it("status lines are explicit and never invent", () => {
    expect(ticketStatusLine([tier({ availability: "open", sale_end_at: "2026-11-15T18:29:00Z" })], NOW)).toBe("EARLY-BIRD OPEN NOW, closes Sun 15 Nov, 11:59pm IST");
    expect(ticketStatusLine([tier({ availability: "upcoming", sale_start_at: "2026-10-12T09:12:00Z" })], NOW)).toBe("EARLY-BIRD OPENS Mon 12 Oct, 2:42pm IST (in 3h 12m)");
    expect(ticketStatusLine([tier({ availability: "open", quantity_note: "limited" })], NOW)).toMatch(/LIMITED early-bird window .*deadline not stated/);
    expect(ticketStatusLine([], NOW)).toBe("Early-bird: not stated, check the link");
  });

  it("builds an .ics with three alarms per sale window", () => {
    const ics = buildIcs(ev, [tier({ sale_start_at: "2026-10-17T04:30:00Z" })], "Test", "https://x.test/e1");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART:20261017T043000Z");
  });
});
