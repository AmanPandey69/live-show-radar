import artistsSeed from "@/data/seed/artists.json";
import demoSeed from "@/data/seed/demo_events.json";
import venuesSeed from "@/config/venues.json";
import type { Repo } from "@/lib/db/repo";
import type { Candidate, ObservationInput } from "@/lib/domain/schemas";
import type { Affinity } from "@/lib/domain/types";
import type { Engine } from "@/lib/pipeline/engine";
import { utcToIstDate } from "@/lib/text/dates-ist";
import { sha256 } from "@/lib/text/normalize";

type SeedArtist = { name: string; is_international: boolean; genres: string[]; affinity: string; aliases: string[]; blocks: string[] };

export async function seedArtists(repo: Repo, opts: { onlyIfEmpty?: boolean } = {}) {
  if (opts.onlyIfEmpty && (await repo.listArtists()).length > 0) return 0;
  let n = 0;
  for (const a of artistsSeed.artists as SeedArtist[]) {
    const row = await repo.upsertArtist({ name: a.name, is_international: a.is_international, genres: a.genres, affinity: a.affinity as Affinity, origin: "seed" });
    await repo.addAlias(row.id, a.name, "canonical");
    if (/^the /i.test(a.name)) await repo.addAlias(row.id, a.name.replace(/^the /i, ""), "the_prefix");
    for (const al of a.aliases) await repo.addAlias(row.id, al, /[^\x00-\x7F]/.test(al) ? "transliteration" : "stage");
    for (const b of a.blocks) await repo.addBlock({ artist_id: row.id, pattern: b, reason: "namesake" });
    n++;
  }
  return n;
}

/** Add any new seed aliases/namesake blocks to artists that already exist (never touches affinity or Spotify data). */
export async function syncSeedGuards(repo: Repo) {
  const existing = await repo.listArtists();
  let n = 0;
  for (const a of artistsSeed.artists as SeedArtist[]) {
    const row = existing.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
    if (!row) continue;
    for (const al of a.aliases) await repo.addAlias(row.id, al, /[^\x00-\x7F]/.test(al) ? "transliteration" : "stage");
    for (const b of a.blocks) { await repo.addBlock({ artist_id: row.id, pattern: b, reason: "namesake" }); n++; }
  }
  return n;
}

export async function seedVenues(repo: Repo) {
  for (const v of venuesSeed.venues) await repo.upsertVenue(v);
  return venuesSeed.venues.length;
}

type DemoTier = { tier_type: string; name_raw: string; price: number | null; availability: string; sale_end_days?: number; sale_start_days?: number; quantity_note?: string };
type DemoEvent = { key: string; artist: string; title: string; venue: string | null; city: string; days_ahead: number; time: string | null; tiers: DemoTier[]; rumour?: boolean };

const dayPlus = (now: Date, d: number) => utcToIstDate(new Date(now.getTime() + d * 86_400_000).toISOString());

/** Build a demo observation whose text contains every evidence quote, so it runs through the REAL truth gate. */
export function demoObservation(d: DemoEvent, now: Date, salt = ""): ObservationInput {
  const date = dayPlus(now, d.days_ahead);
  const lines = [
    d.title,
    `${d.artist} live at ${d.venue ?? "venue to be announced"}, ${d.city}.`,
    `Date: ${date}${d.time ? ` at ${d.time} IST` : ""}.`,
    ...d.tiers.map((t) => {
      const parts = [`${t.name_raw}:`];
      if (t.price) parts.push(`Rs ${t.price}.`);
      if (t.availability === "open") parts.push("On sale now.");
      if (t.sale_end_days != null) parts.push(`Valid till ${dayPlus(now, t.sale_end_days)}.`);
      if (t.sale_start_days != null) parts.push(`Opens ${dayPlus(now, t.sale_start_days)} 12:00.`);
      if (t.quantity_note) parts.push(`${t.quantity_note[0].toUpperCase()}${t.quantity_note.slice(1)} quantity.`);
      return parts.join(" ");
    }),
    d.rumour ? "Rumoured: not officially announced. (SAMPLE DATA)" : "This is SAMPLE DATA for demonstration only.",
  ];
  const text = lines.join("\n");
  const candidate: Candidate = {
    artists: [{ name: d.artist, role: "headliner", evidence: lines[1] }],
    title: d.title, is_festival: false, festival_name: null,
    venue: d.venue, venue_evidence: d.venue ? lines[1] : null,
    city: d.city, city_evidence: lines[1],
    date, date_evidence: lines[2], show_time: d.time, doors_time: null, time_evidence: d.time ? lines[2] : null,
    status_signal: d.rumour ? "rumoured" : "none", status_evidence: d.rumour ? lines[lines.length - 1] : null,
    ticket_url: null,
    tiers: d.tiers.map((t, i) => ({
      tier_type: t.tier_type as Candidate["tiers"][number]["tier_type"], name_raw: t.name_raw,
      price_inr_min: t.price, price_inr_max: t.price,
      sale_start_date: t.sale_start_days != null ? dayPlus(now, t.sale_start_days) : null, sale_start_time: t.sale_start_days != null ? "12:00" : null,
      sale_end_date: t.sale_end_days != null ? dayPlus(now, t.sale_end_days) : null, sale_end_time: null,
      quantity_note: t.quantity_note ?? null, availability: t.availability as "open", evidence: lines[3 + i], field_confidence: "confirmed",
    })),
    other_india_cities: [], bengaluru_mention: null,
  };
  return {
    source_id: "demo", url: `https://example.invalid/demo/${d.key}${salt ? `-${salt}` : ""}`, fetched_at: now.toISOString(), published_at: now.toISOString(),
    content_hash: sha256(text + salt), title: d.title, text, snippet: lines.slice(0, 3).join(" "), candidate, is_primary: !d.rumour, is_demo: true,
  };
}

export async function seedDemo(engine: Engine) {
  const now = engine.now();
  let n = 0;
  for (const d of demoSeed.events as DemoEvent[]) {
    const r = await engine.ingest(demoObservation(d, now)); // demo → mock channel only
    if (r.status === "merged") n++;
  }
  return n;
}

/**
 * Admin "Simulate announcement": a fresh demo event for a followed artist in Bengaluru with an open early-bird
 * tier, run through the REAL pipeline, delivered to real channels labelled [DEMO].
 */
export async function simulateAnnouncement(engine: Engine, artistName?: string) {
  const now = engine.now();
  const artist = engine.artists.find((a) => a.name === artistName) ?? engine.artists.find((a) => (a.affinity_override ?? a.affinity) === "must_see") ?? engine.artists[0];
  const salt = String(now.getTime());
  const d: DemoEvent = {
    key: "sim", artist: artist.name, title: `SAMPLE: ${artist.name}: Simulated Bengaluru show (DEMO ${salt.slice(-5)})`, venue: "Sample Hall (DEMO)",
    city: "Bengaluru", days_ahead: 30 + (Number(salt.slice(-2)) % 20), time: "19:30",
    tiers: [{ tier_type: "early_bird", name_raw: "SAMPLE Early Bird", price: 999, availability: "open", sale_end_days: 2, quantity_note: "limited" }],
  };
  return engine.ingest(demoObservation(d, now, salt), { allowDemoSend: true });
}
