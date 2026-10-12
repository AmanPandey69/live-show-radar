// Persisted shapes mirror db/migrations/0001_init.sql (snake_case on purpose:
// no mapping layer between the DB and the app).

export type Affinity = "must_see" | "like" | "casual";
export type EventStatus =
  | "rumoured" | "announced" | "presale" | "early_bird" | "general_sale"
  | "sold_out" | "postponed" | "cancelled";
export type Confidence = "rumoured" | "unconfirmed" | "confirmed";
export type TierType = "early_bird" | "phase_1" | "presale_card" | "presale_membership" | "general" | "vip";
export type Availability = "open" | "upcoming" | "closed" | "sold_out" | "unknown";
export type FieldConfidence = "confirmed" | "inferred" | "unknown";
export type Priority = "P0" | "P1" | "P2";
export type AlertType =
  | "NEW_SHOW" | "EARLY_BIRD_OPEN" | "EARLY_BIRD_IMMINENT" | "EARLY_BIRD_CLOSING" | "PRESALE"
  | "CHANGED" | "CANCELLED" | "POSTPONED" | "SOLD_OUT" | "UPDATE" | "REMINDER" | "DIGEST";
export type SourceKind = "ticketing" | "news" | "search" | "official" | "promoter" | "venue" | "share" | "api" | "aggregator" | "fixture";
export type SourceStatus = "ok" | "degraded" | "blocked" | "disabled" | "no_data" | "no_grounding";
export type FeedbackKind = "going" | "maybe" | "not_interested" | "wrong_artist" | "wrong_info";

export interface Artist {
  id: string;
  spotify_id: string | null;
  name: string;
  genres: string[];
  is_international: boolean;
  affinity: Affinity;
  affinity_override: Affinity | null;
  top_rank: number | null;
  is_followed: boolean;
  enabled: boolean;
  tour_url: string | null;
  origin: "spotify" | "seed" | "manual" | "csv" | "url";
  last_checked_at: string | null;
  last_deep_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtistAlias {
  id: string;
  artist_id: string;
  alias: string;
  kind: "canonical" | "stage" | "the_prefix" | "transliteration" | "manual" | "feedback";
}

export interface ArtistBlock {
  id: string;
  artist_id: string | null;
  pattern: string;
  reason: "tribute" | "namesake" | "feedback" | "rule";
}

export interface Venue {
  id: string;
  name: string;
  aliases: string[];
  city: string;
  capacity_approx: number | null;
  capacity_source: string | null;
}

export interface Conflict {
  field: string;
  values: { value: unknown; source_url: string; snippet: string }[];
}

export interface EventRow {
  id: string;
  fingerprint: string;
  title: string;
  headliner_ids: string[];
  support_ids: string[];
  is_festival: boolean;
  festival_name: string | null;
  venue_id: string | null;
  venue_name_raw: string | null;
  city: string;
  start_at: string | null;
  start_date_local: string | null; // YYYY-MM-DD in IST
  start_local: string | null;
  doors_at: string | null;
  status: EventStatus;
  confidence: Confidence;
  ticket_url: string | null;
  image_url: string | null;
  tour_other_cities: string[];
  bengaluru_note: { text: string; url: string; snippet: string } | null;
  conflicts: Conflict[];
  urgency: number;
  priority: Priority;
  first_seen_at: string;
  first_public_at: string | null;
  first_source_id: string | null;
  last_changed_at: string;
  is_demo: boolean;
  created_at: string;
}

export interface EventSource {
  id: string;
  event_id: string;
  observation_id: string | null;
  source_id: string;
  url: string;
  is_primary: boolean;
  snippet: string;
  published_at: string | null;
  first_seen_at: string;
}

export interface TicketTier {
  id: string;
  event_id: string;
  tier_type: TierType;
  name_raw: string;
  price_inr_min: number | null;
  price_inr_max: number | null;
  sale_start_at: string | null;
  sale_end_at: string | null;
  quantity_note: string | null;
  availability: Availability;
  source_url: string | null;
  evidence_snippet: string;
  field_confidence: FieldConfidence;
  updated_at: string;
}

export interface Observation {
  id: string;
  source_id: string;
  url: string;
  fetched_at: string;
  published_at: string | null;
  content_hash: string;
  title: string | null;
  snippet: string | null;
  candidate: unknown;
  status: "new" | "filtered_out" | "extracted" | "rejected" | "merged" | "whisper" | "error" | "deferred";
  reason: string | null;
  event_id: string | null;
  is_demo: boolean;
}

export interface Whisper {
  id: string;
  artist_id: string | null;
  kind: "nearby_dates" | "promoter_teaser" | "india_soon" | "coming_soon_page" | "other";
  summary: string;
  url: string;
  snippet: string;
  region: string | null;
  confidence: number;
  dedupe_key: string;
  is_demo: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  event_id: string | null;
  type: AlertType;
  dedupe_key: string;
  priority: Priority;
  payload: Record<string, unknown>;
  text: string;
  is_demo: boolean;
  held_for_quiet: boolean;
  first_public_at: string | null;
  first_seen_at: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface Delivery {
  id: string;
  alert_id: string | null;
  channel: "email" | "inapp" | "mock";
  status: "sent" | "failed" | "skipped" | "mock";
  attempt: number;
  error: string | null;
  external_id: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  event_id: string;
  tier_id: string | null;
  kind: "sale_open" | "sale_close";
  offset_label: "T-24h" | "T-1h" | "T-10m";
  target_at: string;
  fire_at: string;
  dedupe_key: string;
  sent_at: string | null;
  is_demo: boolean;
}

export interface Feedback {
  id: string;
  event_id: string | null;
  alert_id: string | null;
  kind: FeedbackKind;
  note: string | null;
  channel: string;
  created_at: string;
}

export interface SourceRow {
  id: string;
  name: string;
  kind: SourceKind;
  is_primary: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface SourceHealth {
  source_id: string;
  status: SourceStatus;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  degraded_until: string | null;
  items_last_run: number;
}

export interface ScanRun {
  id: string;
  lane: "fast" | "deep" | "daily" | "manual" | "replay";
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "partial" | "error" | "skipped";
  stats: Record<string, unknown>;
  error: string | null;
}

export interface GeminiUsage {
  id: string;
  at: string;
  task: string;
  model: string;
  grounded: boolean;
  status: "ok" | "error" | "invalid" | "budget_skip" | "cache_hit" | "rate_limited";
  input_tokens: number | null;
  output_tokens: number | null;
  search_queries: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface Settings {
  home_city: string;
  quiet_hours: { enabled: boolean; start: string; end: string }; // "23:00" → "07:30" IST
  channels: { email: boolean };
  whispers_enabled: boolean;
  whisper_min_confidence: number;
  confirm_threshold: number; // feedback-tuned: min verifier score to accept a field
  coverage_hours: { must_see: number; default: number };
}

export const DEFAULT_SETTINGS: Settings = {
  home_city: "Bengaluru",
  quiet_hours: { enabled: true, start: "23:00", end: "07:30" },
  channels: { email: true },
  whispers_enabled: true,
  whisper_min_confidence: 0.8,
  confirm_threshold: 0.7,
  coverage_hours: { must_see: 3, default: 12 },
};
