import type {
  Alert, Artist, ArtistAlias, ArtistBlock, Delivery, EventRow, EventSource, Feedback, GeminiUsage, Observation,
  Reminder, ScanRun, Settings, SourceHealth, SourceRow, TicketTier, Venue, Whisper,
} from "@/lib/domain/types";

export type New<T extends { id: string }> = Omit<T, "id" | "created_at" | "updated_at"> & { id?: string };

export interface HttpCacheRow { url: string; etag: string | null; last_modified: string | null; content_hash: string | null; fetched_at: string }
export interface SpotifyTokensRow { access_enc: string; refresh_enc: string; expires_at: string; scope: string | null }

/** Storage boundary. `MemoryRepo` (mock mode, tests) and `NeonRepo` (production) implement it. */
export interface Repo {
  readonly kind: "memory" | "neon";

  // artists
  listArtists(): Promise<Artist[]>;
  upsertArtist(a: Partial<Artist> & { name: string }): Promise<Artist>;
  updateArtist(id: string, patch: Partial<Artist>): Promise<void>;
  touchArtists(ids: string[], field: "last_checked_at" | "last_deep_checked_at", at: string): Promise<void>;
  listAliases(): Promise<ArtistAlias[]>;
  addAlias(artist_id: string, alias: string, kind: ArtistAlias["kind"]): Promise<void>;
  listBlocks(): Promise<ArtistBlock[]>;
  addBlock(b: Omit<ArtistBlock, "id">): Promise<void>;

  // venues
  listVenues(): Promise<Venue[]>;
  upsertVenue(v: Omit<Venue, "id">): Promise<Venue>;

  // events
  listEvents(opts?: { fromDate?: string; includeDemo?: boolean; ids?: string[]; limit?: number }): Promise<EventRow[]>;
  getEvent(id: string): Promise<EventRow | null>;
  findEventsNear(city: string, fromDate: string | null, toDate: string | null): Promise<EventRow[]>;
  insertEvent(e: New<EventRow>): Promise<EventRow>;
  updateEvent(id: string, patch: Partial<EventRow>): Promise<void>;
  listEventSources(eventIds: string[]): Promise<EventSource[]>;
  addEventSource(s: New<EventSource>): Promise<boolean>; // false if (event_id,url) existed
  listTiers(eventIds: string[]): Promise<TicketTier[]>;
  upsertTier(t: New<TicketTier>): Promise<TicketTier>;

  // observations
  findObservation(source_id: string, url: string, content_hash: string): Promise<Observation | null>;
  insertObservation(o: New<Observation>): Promise<Observation>;
  updateObservation(id: string, patch: Partial<Observation>): Promise<void>;
  countObservationsSince(iso: string): Promise<number>;

  // http cache
  getHttpCache(url: string): Promise<HttpCacheRow | null>;
  setHttpCache(row: HttpCacheRow): Promise<void>;

  // sources
  upsertSource(s: SourceRow): Promise<void>;
  listSources(): Promise<SourceRow[]>;
  getHealth(source_id: string): Promise<SourceHealth | null>;
  setHealth(h: SourceHealth): Promise<void>;
  listHealth(): Promise<SourceHealth[]>;

  // alerts & delivery
  insertAlertIfNew(a: New<Alert>): Promise<Alert | null>;
  updateAlert(id: string, patch: Partial<Alert>): Promise<void>;
  listAlerts(opts?: { limit?: number; eventId?: string; held?: boolean; unsent?: boolean }): Promise<Alert[]>;
  addDelivery(d: New<Delivery>): Promise<void>;
  listDeliveries(alertIds: string[]): Promise<Delivery[]>;

  // reminders
  insertReminderIfNew(r: New<Reminder>): Promise<Reminder | null>;
  dueReminders(nowIso: string): Promise<Reminder[]>;
  markReminderSent(id: string, at: string): Promise<void>;
  listReminders(eventId: string): Promise<Reminder[]>;
  deleteUnsentReminders(eventId: string): Promise<void>;

  // feedback & whispers
  addFeedback(f: New<Feedback>): Promise<void>;
  listFeedback(eventId?: string): Promise<Feedback[]>;
  insertWhisperIfNew(w: New<Whisper>): Promise<Whisper | null>;
  listWhispers(limit?: number): Promise<Whisper[]>;

  // ops
  startRun(lane: ScanRun["lane"]): Promise<ScanRun>;
  finishRun(id: string, status: ScanRun["status"], stats: Record<string, unknown>, error?: string | null): Promise<void>;
  listRuns(limit?: number): Promise<ScanRun[]>;
  acquireLock(name: string, holder: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(name: string, holder: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getKv<T>(key: string): Promise<T | null>;
  setKv(key: string, value: unknown): Promise<void>;

  // gemini
  logGemini(u: New<GeminiUsage>): Promise<void>;
  geminiCountsSince(iso: string): Promise<{ calls: number; grounded: number }>;
  listGeminiUsage(sinceIso: string): Promise<GeminiUsage[]>;
  getGeminiCache(key: string): Promise<unknown | null>;
  setGeminiCache(key: string, task: string, response: unknown): Promise<void>;

  // spotify
  getSpotifyTokens(): Promise<SpotifyTokensRow | null>;
  setSpotifyTokens(t: SpotifyTokensRow): Promise<void>;

  // maintenance
  prune(beforeIso: string): Promise<{ observations: number; usage: number }>;
}
