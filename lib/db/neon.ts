import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import type {
  Alert, Artist, ArtistAlias, ArtistBlock, Delivery, EventRow, EventSource, Feedback, GeminiUsage, Observation,
  Reminder, ScanRun, Settings, SourceHealth, SourceRow, TicketTier, Venue, Whisper,
} from "@/lib/domain/types";
import { canonicalCity } from "@/lib/text/cities";
import type { HttpCacheRow, New, Repo, SpotifyTokensRow } from "./repo";

type Row = Record<string, unknown>;

/** Dates → ISO strings so rows match the app's string-typed models. */
function clean<T>(r: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

const JSON_COLS = new Set(["conflicts", "bengaluru_note", "payload", "stats", "config", "candidate", "value", "response"]);

/** Neon (serverless HTTP driver) implementation of Repo. */
export class NeonRepo implements Repo {
  readonly kind = "neon" as const;
  private sql: NeonQueryFunction<false, false>;
  constructor(url: string) {
    this.sql = neon(url);
  }

  private async q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    const rows = (await this.sql.query(text, params)) as Row[];
    return rows.map((r) => clean<T>(r));
  }

  /** INSERT … RETURNING * from a plain object (jsonb columns stringified). */
  private async insert<T>(table: string, obj: Row, onConflict = ""): Promise<T | null> {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const vals = keys.map((k) => (JSON_COLS.has(k) && obj[k] !== null ? JSON.stringify(obj[k]) : obj[k]));
    const rows = await this.q<T>(
      `insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) ${onConflict} returning *`,
      vals,
    );
    return rows[0] ?? null;
  }

  private async update(table: string, id: string, patch: Row, idCol = "id") {
    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined && k !== idCol);
    if (!keys.length) return;
    const vals = keys.map((k) => (JSON_COLS.has(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]));
    await this.q(`update ${table} set ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")} where ${idCol}=$${keys.length + 1}`, [...vals, id]);
  }

  // ── artists
  async listArtists() { return this.q<Artist>("select * from artists order by name"); }
  async upsertArtist(a: Partial<Artist> & { name: string }) {
    const existing = (await this.q<Artist>(
      "select * from artists where ($1::text is not null and spotify_id=$1) or ($2::uuid is not null and id=$2) or lower(name)=lower($3) limit 1",
      [a.spotify_id ?? null, a.id ?? null, a.name],
    ))[0];
    if (existing) {
      await this.update("artists", existing.id, { ...a, id: undefined, updated_at: new Date().toISOString() });
      return { ...existing, ...a, id: existing.id } as Artist;
    }
    return (await this.insert<Artist>("artists", a as Row))!;
  }
  async updateArtist(id: string, patch: Partial<Artist>) { await this.update("artists", id, { ...patch, updated_at: new Date().toISOString() }); }
  async touchArtists(ids: string[], field: "last_checked_at" | "last_deep_checked_at", at: string) {
    if (ids.length) await this.q(`update artists set ${field}=$1 where id = any($2::uuid[])`, [at, ids]);
  }
  async listAliases() { return this.q<ArtistAlias>("select * from artist_aliases"); }
  async addAlias(artist_id: string, alias: string, kind: ArtistAlias["kind"]) {
    await this.q("insert into artist_aliases (artist_id, alias, kind) values ($1,$2,$3) on conflict do nothing", [artist_id, alias, kind]);
  }
  async listBlocks() { return this.q<ArtistBlock>("select * from artist_blocks"); }
  async addBlock(b: Omit<ArtistBlock, "id">) {
    const dup = await this.q("select 1 from artist_blocks where artist_id is not distinct from $1 and lower(pattern)=lower($2)", [b.artist_id, b.pattern]);
    if (!dup.length) await this.insert("artist_blocks", b as Row);
  }

  // ── venues
  async listVenues() { return this.q<Venue>("select * from venues"); }
  async upsertVenue(v: Omit<Venue, "id">) {
    return (await this.q<Venue>(
      `insert into venues (name, aliases, city, capacity_approx, capacity_source) values ($1,$2,$3,$4,$5)
       on conflict (lower(name), lower(city)) do update set aliases=excluded.aliases, capacity_approx=excluded.capacity_approx, capacity_source=excluded.capacity_source
       returning *`,
      [v.name, v.aliases, v.city, v.capacity_approx, v.capacity_source],
    ))[0];
  }

  // ── events
  async listEvents(opts: { fromDate?: string; includeDemo?: boolean; ids?: string[]; limit?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.includeDemo === false) where.push("not is_demo");
    if (opts.ids) { params.push(opts.ids); where.push(`id = any($${params.length}::uuid[])`); }
    if (opts.fromDate) { params.push(opts.fromDate); where.push(`(start_date_local is null or start_date_local >= $${params.length})`); }
    params.push(opts.limit ?? 500);
    return this.q<EventRow>(
      `select * from events ${where.length ? `where ${where.join(" and ")}` : ""} order by start_date_local nulls last, first_seen_at desc limit $${params.length}`,
      params,
    );
  }
  async getEvent(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await this.q<EventRow>("select * from events where id=$1", [id]))[0] ?? null;
  }
  async findEventsNear(city: string, fromDate: string | null, toDate: string | null) {
    const c = canonicalCity(city) ?? city;
    if (!fromDate || !toDate) return this.q<EventRow>("select * from events where city=$1", [c]);
    return this.q<EventRow>("select * from events where city=$1 and (start_date_local is null or start_date_local between $2 and $3)", [c, fromDate, toDate]);
  }
  async insertEvent(e: New<EventRow>) { return (await this.insert<EventRow>("events", e as Row))!; }
  async updateEvent(id: string, patch: Partial<EventRow>) { await this.update("events", id, patch as Row); }
  async listEventSources(eventIds: string[]) {
    if (!eventIds.length) return [];
    return this.q<EventSource>("select * from event_sources where event_id = any($1::uuid[]) order by first_seen_at", [eventIds]);
  }
  async addEventSource(s: New<EventSource>) {
    const r = await this.insert<EventSource>("event_sources", s as Row, "on conflict (event_id, url) do nothing");
    return !!r;
  }
  async listTiers(eventIds: string[]) {
    if (!eventIds.length) return [];
    return this.q<TicketTier>("select * from ticket_tiers where event_id = any($1::uuid[]) order by tier_type, name_raw", [eventIds]);
  }
  async upsertTier(t: New<TicketTier>) {
    const cur = (await this.q<TicketTier>("select * from ticket_tiers where event_id=$1 and tier_type=$2 and lower(name_raw)=lower($3)", [t.event_id, t.tier_type, t.name_raw]))[0];
    if (cur) {
      await this.update("ticket_tiers", cur.id, { ...t, id: undefined, updated_at: new Date().toISOString() });
      return { ...cur, ...t, id: cur.id } as TicketTier;
    }
    return (await this.insert<TicketTier>("ticket_tiers", t as Row))!;
  }

  // ── observations
  async findObservation(source_id: string, url: string, content_hash: string) {
    return (await this.q<Observation>("select * from observations where source_id=$1 and url=$2 and content_hash=$3", [source_id, url, content_hash]))[0] ?? null;
  }
  async insertObservation(o: New<Observation>) {
    const r = await this.insert<Observation>("observations", o as Row, "on conflict (source_id, url, content_hash) do update set fetched_at=excluded.fetched_at");
    return r!;
  }
  async updateObservation(id: string, patch: Partial<Observation>) { await this.update("observations", id, patch as Row); }
  async countObservationsSince(iso: string) {
    return Number((await this.q<{ n: string }>("select count(*) n from observations where fetched_at >= $1", [iso]))[0]?.n ?? 0);
  }

  // ── http cache
  async getHttpCache(url: string) { return (await this.q<HttpCacheRow>("select * from http_cache where url=$1", [url]))[0] ?? null; }
  async setHttpCache(r: HttpCacheRow) {
    await this.q(
      `insert into http_cache (url, etag, last_modified, content_hash, fetched_at) values ($1,$2,$3,$4,$5)
       on conflict (url) do update set etag=excluded.etag, last_modified=excluded.last_modified, content_hash=excluded.content_hash, fetched_at=excluded.fetched_at`,
      [r.url, r.etag, r.last_modified, r.content_hash, r.fetched_at],
    );
  }

  // ── sources
  async upsertSource(s: SourceRow) {
    await this.q(
      `insert into sources (id, name, kind, is_primary, enabled, config) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name=excluded.name, kind=excluded.kind, is_primary=excluded.is_primary, config=excluded.config`,
      [s.id, s.name, s.kind, s.is_primary, s.enabled, JSON.stringify(s.config)],
    );
  }
  async listSources() { return this.q<SourceRow>("select * from sources order by id"); }
  async getHealth(id: string) { return (await this.q<SourceHealth>("select * from source_health where source_id=$1", [id]))[0] ?? null; }
  async setHealth(h: SourceHealth) {
    await this.q(
      `insert into source_health (source_id, status, last_run_at, last_ok_at, last_error_at, last_error, consecutive_failures, degraded_until, items_last_run)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (source_id) do update set status=excluded.status, last_run_at=excluded.last_run_at, last_ok_at=excluded.last_ok_at,
         last_error_at=excluded.last_error_at, last_error=excluded.last_error, consecutive_failures=excluded.consecutive_failures,
         degraded_until=excluded.degraded_until, items_last_run=excluded.items_last_run`,
      [h.source_id, h.status, h.last_run_at, h.last_ok_at, h.last_error_at, h.last_error, h.consecutive_failures, h.degraded_until, h.items_last_run],
    );
  }
  async listHealth() { return this.q<SourceHealth>("select * from source_health order by source_id"); }

  // ── alerts
  async insertAlertIfNew(a: New<Alert>) { return this.insert<Alert>("alerts", a as Row, "on conflict (dedupe_key) do nothing"); }
  async updateAlert(id: string, patch: Partial<Alert>) { await this.update("alerts", id, patch as Row); }
  async listAlerts(opts: { limit?: number; eventId?: string; held?: boolean; unsent?: boolean } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.eventId) { params.push(opts.eventId); where.push(`event_id=$${params.length}`); }
    if (opts.held !== undefined) { params.push(opts.held); where.push(`held_for_quiet=$${params.length}`); }
    if (opts.unsent) where.push("sent_at is null");
    params.push(opts.limit ?? 200);
    return this.q<Alert>(`select * from alerts ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc limit $${params.length}`, params);
  }
  async addDelivery(d: New<Delivery>) { await this.insert("notification_deliveries", d as Row); }
  async listDeliveries(alertIds: string[]) {
    if (!alertIds.length) return [];
    return this.q<Delivery>("select * from notification_deliveries where alert_id = any($1::uuid[]) order by created_at", [alertIds]);
  }

  // ── reminders
  async insertReminderIfNew(r: New<Reminder>) { return this.insert<Reminder>("reminders", r as Row, "on conflict (dedupe_key) do nothing"); }
  async dueReminders(nowIso: string) { return this.q<Reminder>("select * from reminders where sent_at is null and fire_at <= $1 order by fire_at limit 50", [nowIso]); }
  async markReminderSent(id: string, at: string) { await this.q("update reminders set sent_at=$1 where id=$2", [at, id]); }
  async listReminders(eventId: string) { return this.q<Reminder>("select * from reminders where event_id=$1 order by fire_at", [eventId]); }
  async deleteUnsentReminders(eventId: string) { await this.q("delete from reminders where event_id=$1 and sent_at is null", [eventId]); }

  // ── feedback & whispers
  async addFeedback(f: New<Feedback>) { await this.insert("feedback", f as Row); }
  async listFeedback(eventId?: string) {
    return eventId ? this.q<Feedback>("select * from feedback where event_id=$1 order by created_at desc", [eventId]) : this.q<Feedback>("select * from feedback order by created_at desc limit 500");
  }
  async insertWhisperIfNew(w: New<Whisper>) { return this.insert<Whisper>("whispers", w as Row, "on conflict (dedupe_key) do nothing"); }
  async listWhispers(limit = 100) { return this.q<Whisper>("select * from whispers order by created_at desc limit $1", [limit]); }

  // ── ops
  async startRun(lane: ScanRun["lane"]) { return (await this.insert<ScanRun>("scan_runs", { lane }))!; }
  async finishRun(id: string, status: ScanRun["status"], stats: Record<string, unknown>, error: string | null = null) {
    await this.q("update scan_runs set status=$1, stats=$2, error=$3, finished_at=now() where id=$4", [status, JSON.stringify(stats), error, id]);
  }
  async listRuns(limit = 50) { return this.q<ScanRun>("select * from scan_runs order by started_at desc limit $1", [limit]); }
  async acquireLock(name: string, holder: string, ttl: number) {
    const r = await this.q<{ ok: boolean }>("select acquire_lock($1,$2,$3) as ok", [name, holder, ttl]);
    return !!r[0]?.ok;
  }
  async releaseLock(name: string, holder: string) { await this.q("delete from locks where name=$1 and holder=$2", [name, holder]); }
  async getSettings() {
    const r = (await this.q<{ value: Settings }>("select value from settings where key='app'"))[0];
    return { ...DEFAULT_SETTINGS, ...(r?.value ?? {}) };
  }
  async setSettings(patch: Partial<Settings>) {
    const next = { ...(await this.getSettings()), ...patch };
    await this.q("insert into settings (key, value) values ('app',$1) on conflict (key) do update set value=excluded.value", [JSON.stringify(next)]);
    return next;
  }
  async getKv<T>(key: string) {
    return ((await this.q<{ value: T }>("select value from settings where key=$1", [`kv:${key}`]))[0]?.value ?? null) as T | null;
  }
  async setKv(key: string, value: unknown) {
    await this.q("insert into settings (key, value) values ($1,$2) on conflict (key) do update set value=excluded.value", [`kv:${key}`, JSON.stringify(value)]);
  }

  // ── gemini
  async logGemini(u: New<GeminiUsage>) { await this.insert("gemini_usage", u as Row); }
  async geminiCountsSince(iso: string) {
    const r = (await this.q<{ calls: string; grounded: string }>(
      "select count(*) calls, count(*) filter (where grounded) grounded from gemini_usage where at >= $1 and status in ('ok','error','invalid','rate_limited')",
      [iso],
    ))[0];
    return { calls: Number(r?.calls ?? 0), grounded: Number(r?.grounded ?? 0) };
  }
  async listGeminiUsage(sinceIso: string) { return this.q<GeminiUsage>("select * from gemini_usage where at >= $1 order by at desc limit 1000", [sinceIso]); }
  async getGeminiCache(key: string) { return (await this.q<{ response: unknown }>("select response from gemini_cache where key=$1", [key]))[0]?.response ?? null; }
  async setGeminiCache(key: string, task: string, response: unknown) {
    await this.q("insert into gemini_cache (key, task, response) values ($1,$2,$3) on conflict (key) do update set response=excluded.response", [key, task, JSON.stringify(response)]);
  }

  // ── spotify
  async getSpotifyTokens() { return (await this.q<SpotifyTokensRow>("select access_enc, refresh_enc, expires_at, scope from spotify_tokens where id=1"))[0] ?? null; }
  async setSpotifyTokens(t: SpotifyTokensRow) {
    await this.q(
      `insert into spotify_tokens (id, access_enc, refresh_enc, expires_at, scope) values (1,$1,$2,$3,$4)
       on conflict (id) do update set access_enc=excluded.access_enc, refresh_enc=excluded.refresh_enc, expires_at=excluded.expires_at, scope=excluded.scope, updated_at=now()`,
      [t.access_enc, t.refresh_enc, t.expires_at, t.scope],
    );
  }

  async prune(beforeIso: string) {
    const o = await this.q("delete from observations where fetched_at < $1 and event_id is null returning id", [beforeIso]);
    const u = await this.q("delete from gemini_usage where at < $1 returning id", [beforeIso]);
    await this.q("delete from gemini_cache where created_at < $1", [beforeIso]);
    return { observations: o.length, usage: u.length };
  }
}
