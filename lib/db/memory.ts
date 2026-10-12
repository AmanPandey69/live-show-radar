import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import type {
  Alert, Artist, ArtistAlias, ArtistBlock, Delivery, EventRow, EventSource, Feedback, GeminiUsage, Observation,
  Reminder, ScanRun, Settings, SourceHealth, SourceRow, TicketTier, Venue, Whisper,
} from "@/lib/domain/types";
import { canonicalCity } from "@/lib/text/cities";
import type { HttpCacheRow, New, Repo, SpotifyTokensRow } from "./repo";

const now = () => new Date().toISOString();
const clone = <T>(x: T): T => structuredClone(x);

/** In-memory Repo for MOCK_MODE and tests. Mirrors the unique constraints of the SQL schema. */
export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  artists: Artist[] = [];
  aliases: ArtistAlias[] = [];
  blocks: ArtistBlock[] = [];
  venues: Venue[] = [];
  events: EventRow[] = [];
  eventSources: EventSource[] = [];
  tiers: TicketTier[] = [];
  observations: Observation[] = [];
  http = new Map<string, HttpCacheRow>();
  sources = new Map<string, SourceRow>();
  health = new Map<string, SourceHealth>();
  alerts: Alert[] = [];
  deliveries: Delivery[] = [];
  reminders: Reminder[] = [];
  feedback: Feedback[] = [];
  whispers: Whisper[] = [];
  runs: ScanRun[] = [];
  locks = new Map<string, { holder: string; expires: number }>();
  settings: Settings = clone(DEFAULT_SETTINGS);
  kv = new Map<string, unknown>();
  usage: GeminiUsage[] = [];
  cache = new Map<string, unknown>();
  spotify: SpotifyTokensRow | null = null;

  async listArtists() { return clone(this.artists); }
  async upsertArtist(a: Partial<Artist> & { name: string }) {
    let row = this.artists.find((x) => (a.spotify_id && x.spotify_id === a.spotify_id) || (a.id && x.id === a.id) || x.name.toLowerCase() === a.name.toLowerCase());
    if (row) {
      Object.assign(row, a, { id: row.id, updated_at: now() });
    } else {
      row = {
        id: a.id ?? randomUUID(), spotify_id: null, genres: [], is_international: false, affinity: "like", affinity_override: null,
        top_rank: null, is_followed: true, enabled: true, tour_url: null, origin: "seed", last_checked_at: null,
        last_deep_checked_at: null, created_at: now(), updated_at: now(), ...a,
      } as Artist;
      this.artists.push(row);
    }
    return clone(row);
  }
  async updateArtist(id: string, patch: Partial<Artist>) {
    const r = this.artists.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { updated_at: now() });
  }
  async touchArtists(ids: string[], field: "last_checked_at" | "last_deep_checked_at", at: string) {
    for (const a of this.artists) if (ids.includes(a.id)) a[field] = at;
  }
  async listAliases() { return clone(this.aliases); }
  async addAlias(artist_id: string, alias: string, kind: ArtistAlias["kind"]) {
    if (this.aliases.some((x) => x.artist_id === artist_id && x.alias.toLowerCase() === alias.toLowerCase())) return;
    this.aliases.push({ id: randomUUID(), artist_id, alias, kind });
  }
  async listBlocks() { return clone(this.blocks); }
  async addBlock(b: Omit<ArtistBlock, "id">) {
    if (this.blocks.some((x) => x.artist_id === b.artist_id && x.pattern.toLowerCase() === b.pattern.toLowerCase())) return;
    this.blocks.push({ id: randomUUID(), ...b });
  }

  async listVenues() { return clone(this.venues); }
  async upsertVenue(v: Omit<Venue, "id">) {
    let row = this.venues.find((x) => x.name.toLowerCase() === v.name.toLowerCase() && x.city.toLowerCase() === v.city.toLowerCase());
    if (row) Object.assign(row, v);
    else this.venues.push((row = { id: randomUUID(), ...v }));
    return clone(row);
  }

  async listEvents(opts: { fromDate?: string; includeDemo?: boolean; ids?: string[]; limit?: number } = {}) {
    let rows = this.events.filter((e) => (opts.includeDemo ?? true) || !e.is_demo);
    if (opts.ids) rows = rows.filter((e) => opts.ids!.includes(e.id));
    if (opts.fromDate) rows = rows.filter((e) => !e.start_date_local || e.start_date_local >= opts.fromDate!);
    rows.sort((a, b) => (a.start_date_local ?? "9999").localeCompare(b.start_date_local ?? "9999"));
    return clone(opts.limit ? rows.slice(0, opts.limit) : rows);
  }
  async getEvent(id: string) { return clone(this.events.find((e) => e.id === id) ?? null); }
  async findEventsNear(city: string, fromDate: string | null, toDate: string | null) {
    const c = canonicalCity(city) ?? city;
    return clone(this.events.filter((e) => (canonicalCity(e.city) ?? e.city) === c && (
      !fromDate || !toDate || !e.start_date_local || (e.start_date_local >= fromDate && e.start_date_local <= toDate))));
  }
  async insertEvent(e: New<EventRow>) {
    if (this.events.some((x) => x.fingerprint === e.fingerprint)) throw new Error(`duplicate fingerprint ${e.fingerprint}`);
    const row = { ...e, id: e.id ?? randomUUID(), created_at: now() } as EventRow;
    this.events.push(row);
    return clone(row);
  }
  async updateEvent(id: string, patch: Partial<EventRow>) {
    const r = this.events.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async listEventSources(eventIds: string[]) { return clone(this.eventSources.filter((s) => eventIds.includes(s.event_id))); }
  async addEventSource(s: New<EventSource>) {
    if (this.eventSources.some((x) => x.event_id === s.event_id && x.url === s.url)) return false;
    this.eventSources.push({ ...s, id: s.id ?? randomUUID() } as EventSource);
    return true;
  }
  async listTiers(eventIds: string[]) { return clone(this.tiers.filter((t) => eventIds.includes(t.event_id))); }
  async upsertTier(t: New<TicketTier>) {
    let row = this.tiers.find((x) => x.event_id === t.event_id && x.tier_type === t.tier_type && x.name_raw.toLowerCase() === t.name_raw.toLowerCase());
    if (row) Object.assign(row, t, { id: row.id, updated_at: now() });
    else this.tiers.push((row = { ...t, id: t.id ?? randomUUID(), updated_at: now() } as TicketTier));
    return clone(row);
  }

  async findObservation(source_id: string, url: string, content_hash: string) {
    return clone(this.observations.find((o) => o.source_id === source_id && o.url === url && o.content_hash === content_hash) ?? null);
  }
  async insertObservation(o: New<Observation>) {
    const row = { ...o, id: o.id ?? randomUUID() } as Observation;
    this.observations.push(row);
    return clone(row);
  }
  async updateObservation(id: string, patch: Partial<Observation>) {
    const r = this.observations.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async countObservationsSince(iso: string) { return this.observations.filter((o) => o.fetched_at >= iso).length; }

  async getHttpCache(url: string) { return clone(this.http.get(url) ?? null); }
  async setHttpCache(row: HttpCacheRow) { this.http.set(row.url, clone(row)); }

  async upsertSource(s: SourceRow) { this.sources.set(s.id, clone(s)); }
  async listSources() { return clone([...this.sources.values()]); }
  async getHealth(id: string) { return clone(this.health.get(id) ?? null); }
  async setHealth(h: SourceHealth) { this.health.set(h.source_id, clone(h)); }
  async listHealth() { return clone([...this.health.values()]); }

  async insertAlertIfNew(a: New<Alert>) {
    if (this.alerts.some((x) => x.dedupe_key === a.dedupe_key)) return null;
    const row = { ...a, id: a.id ?? randomUUID(), created_at: now() } as Alert;
    this.alerts.push(row);
    return clone(row);
  }
  async updateAlert(id: string, patch: Partial<Alert>) {
    const r = this.alerts.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async listAlerts(opts: { limit?: number; eventId?: string; held?: boolean; unsent?: boolean } = {}) {
    let rows = [...this.alerts];
    if (opts.eventId) rows = rows.filter((a) => a.event_id === opts.eventId);
    if (opts.held !== undefined) rows = rows.filter((a) => a.held_for_quiet === opts.held);
    if (opts.unsent) rows = rows.filter((a) => !a.sent_at);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return clone(rows.slice(0, opts.limit ?? 200));
  }
  async addDelivery(d: New<Delivery>) { this.deliveries.push({ ...d, id: d.id ?? randomUUID(), created_at: now() } as Delivery); }
  async listDeliveries(alertIds: string[]) { return clone(this.deliveries.filter((d) => d.alert_id && alertIds.includes(d.alert_id))); }

  async insertReminderIfNew(r: New<Reminder>) {
    if (this.reminders.some((x) => x.dedupe_key === r.dedupe_key)) return null;
    const row = { ...r, id: r.id ?? randomUUID() } as Reminder;
    this.reminders.push(row);
    return clone(row);
  }
  async dueReminders(nowIso: string) {
    return clone(this.reminders.filter((r) => !r.sent_at && r.fire_at <= nowIso).sort((a, b) => a.fire_at.localeCompare(b.fire_at)));
  }
  async markReminderSent(id: string, at: string) {
    const r = this.reminders.find((x) => x.id === id);
    if (r) r.sent_at = at;
  }
  async listReminders(eventId: string) { return clone(this.reminders.filter((r) => r.event_id === eventId)); }
  async deleteUnsentReminders(eventId: string) { this.reminders = this.reminders.filter((r) => r.event_id !== eventId || r.sent_at); }

  async addFeedback(f: New<Feedback>) { this.feedback.push({ ...f, id: f.id ?? randomUUID(), created_at: now() } as Feedback); }
  async listFeedback(eventId?: string) { return clone(this.feedback.filter((f) => !eventId || f.event_id === eventId)); }
  async insertWhisperIfNew(w: New<Whisper>) {
    if (this.whispers.some((x) => x.dedupe_key === w.dedupe_key)) return null;
    const row = { ...w, id: w.id ?? randomUUID(), created_at: now() } as Whisper;
    this.whispers.push(row);
    return clone(row);
  }
  async listWhispers(limit = 100) { return clone([...this.whispers].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)); }

  async startRun(lane: ScanRun["lane"]) {
    const run: ScanRun = { id: randomUUID(), lane, started_at: now(), finished_at: null, status: "running", stats: {}, error: null };
    this.runs.push(run);
    return clone(run);
  }
  async finishRun(id: string, status: ScanRun["status"], stats: Record<string, unknown>, error: string | null = null) {
    const r = this.runs.find((x) => x.id === id);
    if (r) Object.assign(r, { status, stats, error, finished_at: now() });
  }
  async listRuns(limit = 50) { return clone([...this.runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit)); }
  async acquireLock(name: string, holder: string, ttl: number) {
    const l = this.locks.get(name);
    if (l && l.expires > Date.now() && l.holder !== holder) return false;
    this.locks.set(name, { holder, expires: Date.now() + ttl * 1000 });
    return true;
  }
  async releaseLock(name: string, holder: string) {
    if (this.locks.get(name)?.holder === holder) this.locks.delete(name);
  }
  async getSettings() { return clone(this.settings); }
  async setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    return clone(this.settings);
  }
  async getKv<T>(key: string) { return clone((this.kv.get(key) as T) ?? null); }
  async setKv(key: string, value: unknown) { this.kv.set(key, clone(value)); }

  async logGemini(u: New<GeminiUsage>) { this.usage.push({ ...u, id: u.id ?? randomUUID() } as GeminiUsage); }
  async geminiCountsSince(iso: string) {
    const rows = this.usage.filter((u) => u.at >= iso && (u.status === "ok" || u.status === "error" || u.status === "invalid" || u.status === "rate_limited"));
    return { calls: rows.length, grounded: rows.filter((u) => u.grounded).length };
  }
  async listGeminiUsage(sinceIso: string) { return clone(this.usage.filter((u) => u.at >= sinceIso)); }
  async getGeminiCache(key: string) { return clone(this.cache.get(key) ?? null); }
  async setGeminiCache(key: string, _task: string, response: unknown) { this.cache.set(key, clone(response)); }

  async getSpotifyTokens() { return clone(this.spotify); }
  async setSpotifyTokens(t: SpotifyTokensRow) { this.spotify = clone(t); }

  async prune(beforeIso: string) {
    const o = this.observations.length;
    const u = this.usage.length;
    this.observations = this.observations.filter((x) => x.fetched_at >= beforeIso || x.event_id);
    this.usage = this.usage.filter((x) => x.at >= beforeIso);
    return { observations: o - this.observations.length, usage: u - this.usage.length };
  }
}
