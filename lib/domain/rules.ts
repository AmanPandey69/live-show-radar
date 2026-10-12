import type { Affinity, Confidence, EventRow, EventStatus, Priority, TicketTier } from "./types";
import { canonicalCity, isHomeCity } from "@/lib/text/cities";
import { tokenSimilarity } from "@/lib/text/normalize";

// ───────────────────────── Dedupe fingerprint ─────────────────────────

/** Stable key: sorted headliner ids + canonical city + IST date. Used as the unique index. */
export function fingerprint(headlinerIds: string[], city: string, date: string | null): string {
  const c = canonicalCity(city) ?? city;
  return `${[...headlinerIds].sort().join("+")}|${c}|${date ?? "tbd"}`;
}

export interface DedupeCandidate {
  headliner_ids: string[];
  support_ids: string[];
  city: string;
  start_date_local: string | null;
  venue_name_raw: string | null;
  festival_name: string | null;
}

function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function venuesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // unknown venue never blocks a merge
  return tokenSimilarity(a, b) >= 0.5;
}

/**
 * Same real show? Shared artist + same city + date within ±1 day + compatible venue.
 * Two different dates at the SAME venue within a day are treated as a two-night run (separate events)
 * only when both events already exist with exact dates (handled by the caller passing siblings).
 */
export function isSameShow(c: DedupeCandidate, e: Pick<EventRow, "headliner_ids" | "support_ids" | "city" | "start_date_local" | "venue_name_raw" | "festival_name">, siblingDates: string[] = []): boolean {
  const ca = new Set([...c.headliner_ids, ...c.support_ids]);
  const shared = [...e.headliner_ids, ...e.support_ids].some((id) => ca.has(id));
  const sameFestival = !!c.festival_name && !!e.festival_name && tokenSimilarity(c.festival_name, e.festival_name, new Set()) >= 0.6;
  if (!shared && !sameFestival) return false;
  if ((canonicalCity(c.city) ?? c.city) !== (canonicalCity(e.city) ?? e.city)) return false;
  if (!c.start_date_local || !e.start_date_local) return venuesCompatible(c.venue_name_raw, e.venue_name_raw);
  const d = dayDiff(c.start_date_local, e.start_date_local);
  if (d === 0) return true;
  if (d > 1) return false;
  if (siblingDates.includes(c.start_date_local)) return false; // an exact-date event already exists
  return venuesCompatible(c.venue_name_raw, e.venue_name_raw);
}

// ───────────────────────── Corroboration ─────────────────────────

export interface SourceRef { url: string; is_primary: boolean; source_id: string; rumour?: boolean }

const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
};

/** Confirmed = ≥1 primary source OR ≥2 independent hosts. Rumoured = only rumour-worded mentions. */
export function corroborate(sources: SourceRef[]): Confidence {
  if (sources.some((s) => s.is_primary)) return "confirmed";
  const solid = sources.filter((s) => !s.rumour);
  const hosts = new Set(solid.map((s) => hostOf(s.url)));
  if (hosts.size >= 2) return "confirmed";
  if (solid.length >= 1) return "unconfirmed";
  return "rumoured";
}

const PRIMARY_HOSTS = [
  "district.in", "bookmyshow.com", "in.bookmyshow.com", "skillboxes.com", "ticketgenie.in", "townscript.com",
  "sortmyscene.com", "insider.in", "zomato.com", "paytm.com", "highape.com", "ticketmaster.com",
];
export function isPrimaryUrl(url: string, extraOfficialHosts: string[] = []): boolean {
  const h = hostOf(url);
  return [...PRIMARY_HOSTS, ...extraOfficialHosts].some((p) => h === p || h.endsWith(`.${p}`));
}

// ───────────────────────── Event status state machine ─────────────────────────

const TERMINAL: EventStatus[] = ["cancelled"];

/** Derive the event status from tiers + explicit status signals. Explicit cancel/postpone/sold-out win. */
export function deriveStatus(
  prev: EventStatus | null,
  tiers: Pick<TicketTier, "tier_type" | "availability">[],
  explicit: EventStatus | null,
  confidence: Confidence,
): EventStatus {
  if (explicit === "cancelled" || explicit === "postponed" || explicit === "sold_out") return explicit;
  if (prev && TERMINAL.includes(prev) && !explicit) return prev;
  const open = tiers.filter((t) => t.availability === "open");
  if (tiers.length > 0 && tiers.every((t) => t.availability === "sold_out")) return "sold_out";
  if (open.some((t) => t.tier_type === "early_bird" || t.tier_type === "phase_1")) return "early_bird";
  if (open.some((t) => t.tier_type.startsWith("presale"))) return "presale";
  if (open.length > 0) return "general_sale";
  if (explicit) return explicit;
  if (prev === "postponed") return "postponed";
  return confidence === "rumoured" ? "rumoured" : "announced";
}

/** Allowed transitions; anything else is recorded as a conflict rather than applied. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  if (from === to) return true;
  if (from === "cancelled") return false; // only a new event (new fingerprint) can resurrect a cancelled show
  if (from === "sold_out") return to === "cancelled" || to === "postponed" || to === "general_sale"; // extra release
  return true;
}

// ───────────────────────── Priority & urgency ─────────────────────────

export function effectiveAffinity(a: { affinity: Affinity; affinity_override: Affinity | null }): Affinity {
  return a.affinity_override ?? a.affinity;
}

export interface PriorityInput {
  city: string;
  home_city: string;
  affinity: Affinity; // best affinity among the event's artists
  tiers: Pick<TicketTier, "tier_type" | "availability">[];
}

const isEarly = (t: Pick<TicketTier, "tier_type">) =>
  t.tier_type === "early_bird" || t.tier_type === "phase_1" || t.tier_type.startsWith("presale");

/**
 * P0 = home city AND (early-bird open/imminent OR must-see).
 * P1 = other-city early-bird (open/imminent), or any home-city show.
 * P2 = everything else.
 */
export function priorityFor(p: PriorityInput): Priority {
  const home = isHomeCity(p.city, p.home_city);
  const ebLive = p.tiers.some((t) => isEarly(t) && (t.availability === "open" || t.availability === "upcoming"));
  if (home && (ebLive || p.affinity === "must_see")) return "P0";
  if (home || ebLive) return "P1";
  return "P2";
}

export interface UrgencyInput extends PriorityInput {
  capacity_approx: number | null;
  announced_at: string | null; // first_public_at ?? first_seen_at
  now?: Date;
}

/**
 * 0–100. Small rooms sell out fastest; early-bird windows last ~6h; must-see weighs most.
 * Drives channel choice and reminder cadence (≥70: Telegram + email + all reminders).
 */
export function urgencyScore(u: UrgencyInput): number {
  const now = (u.now ?? new Date()).getTime();
  let s = 0;
  s += { must_see: 35, like: 20, casual: 8 }[u.affinity];
  if (isHomeCity(u.city, u.home_city)) s += 15;
  const eb = u.tiers.filter(isEarly);
  if (eb.some((t) => t.availability === "open")) s += 25;
  else if (eb.some((t) => t.availability === "upcoming")) s += 20;
  else if (u.tiers.some((t) => t.availability === "open")) s += 8;
  const cap = u.capacity_approx;
  if (cap != null) s += cap <= 600 ? 15 : cap <= 2000 ? 10 : cap <= 8000 ? 5 : 2;
  else s += 7; // unknown capacity: assume mid-size
  if (u.announced_at) {
    const hours = (now - Date.parse(u.announced_at)) / 3_600_000;
    s += hours < 6 ? 10 : hours < 24 ? 6 : hours < 72 ? 3 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}
