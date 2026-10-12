import type { Candidate, TierCandidate, Verification } from "@/lib/domain/schemas";
import { canonicalCity } from "@/lib/text/cities";
import { norm } from "@/lib/text/normalize";

/**
 * Truthfulness gate (deterministic). A fact survives only if its evidence quote really appears in the source
 * text AND the quote actually supports the value. Unsupported fields are nulled (or set to "unknown");
 * an event without a supported city or artist is rejected entirely.
 */

export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const q = norm(quote);
  if (q.length < 3) return false;
  const t = norm(text);
  if (t.includes(q)) return true;
  // Allow ellipsis-joined quotes: every fragment must be present.
  const parts = quote.split(/…|\.\.\./).map(norm).filter((x) => x.length >= 3);
  return parts.length > 1 && parts.every((p) => t.includes(p));
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Does the quote plausibly state this date? (day number + month, or ISO/numeric form) */
export function quoteSupportsDate(quote: string, date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const q = quote.toLowerCase();
  if (q.includes(date)) return true;
  const dayRe = new RegExp(`(^|\\D)0?${d}(st|nd|rd|th)?(\\D|$)`);
  const monthHit = q.includes(MONTH_NAMES[m - 1]) || new RegExp(`(^|\\D)${d}[/.-]0?${m}([/.-]|\\D|$)`).test(q);
  if (dayRe.test(q) && monthHit) return true;
  // ISO UTC timestamps in JSON-LD: "2026-11-14T13:30:00Z" → date may be the IST day (same or +1)
  const iso = /(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2})/.exec(q);
  if (iso) {
    const utc = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5]);
    const ist = new Date(utc + 330 * 60_000);
    return ist.getUTCFullYear() === y && ist.getUTCMonth() + 1 === m && ist.getUTCDate() === d;
  }
  return false;
}

/** Hour (and minute if stated) appears in the quote: "7 PM", "19:00", "7:30pm", or ISO time. */
export function quoteSupportsTime(quote: string, time: string): boolean {
  const [h, mi] = time.split(":").map(Number);
  const q = quote.toLowerCase();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "a" : "p";
  if (new RegExp(`(^|\\D)${h12}(?::|\\.)?${mi ? String(mi).padStart(2, "0") : "(00)?"}\\s*${ampm}\\.?m`).test(q)) return true;
  if (q.includes(`${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`)) return true;
  const iso = /t(\d{2}):(\d{2})/.exec(q);
  if (iso) {
    const total = (+iso[1] * 60 + +iso[2] + 330) % 1440;
    return total === h * 60 + mi;
  }
  return false;
}

export function quoteSupportsPrice(quote: string, price: number): boolean {
  const digits = quote.replace(/[,\s]/g, "");
  return new RegExp(`(^|\\D)${price}(\\D|$)`).test(digits);
}

export interface TruthReport { rejected: boolean; reason: string | null; dropped: string[] }

/**
 * Applies the gate in place-free fashion: returns a cleaned copy plus what was dropped.
 * `verification` (Gemini second pass) is optional; when present, any field it marks unsupported is dropped too.
 */
export function enforceTruth(c: Candidate, text: string, verification?: Verification | null): { candidate: Candidate; report: TruthReport } {
  const dropped: string[] = [];
  const unsupported = new Set((verification?.fields ?? []).filter((f) => !f.supported).map((f) => f.path));
  const out: Candidate = structuredClone(c);

  out.artists = out.artists.filter((a, i) => {
    const ok = quoteInText(a.evidence, text) && norm(a.evidence).includes(norm(a.name).replace(/^the /, ""));
    if (!ok || unsupported.has(`artists[${i}]`)) dropped.push(`artists[${i}]`);
    return ok && !unsupported.has(`artists[${i}]`);
  });

  if (!quoteInText(out.city_evidence, text) || canonicalCity(out.city_evidence) !== canonicalCity(out.city) || unsupported.has("city")) {
    return { candidate: out, report: { rejected: true, reason: "city not supported by evidence", dropped: [...dropped, "city"] } };
  }

  if (out.venue && (!quoteInText(out.venue_evidence, text) || !norm(out.venue_evidence ?? "").includes(norm(out.venue).split(" ")[0]) || unsupported.has("venue"))) {
    dropped.push("venue");
    out.venue = null;
    out.venue_evidence = null;
  }
  if (out.date && (!quoteInText(out.date_evidence, text) || !quoteSupportsDate(out.date_evidence!, out.date) || unsupported.has("date"))) {
    dropped.push("date");
    out.date = null;
    out.date_evidence = null;
  }
  const timeOk = (t: string | null) => !!t && quoteInText(out.time_evidence, text) && quoteSupportsTime(out.time_evidence!, t);
  if (out.show_time && (!timeOk(out.show_time) || unsupported.has("show_time"))) {
    dropped.push("show_time");
    out.show_time = null;
  }
  if (out.doors_time && (!timeOk(out.doors_time) || unsupported.has("doors_time"))) {
    dropped.push("doors_time");
    out.doors_time = null;
  }
  if (out.status_signal !== "none" && (!quoteInText(out.status_evidence, text) || unsupported.has("status_signal"))) {
    dropped.push("status_signal");
    out.status_signal = "none";
  }
  if (out.bengaluru_mention && !quoteInText(out.bengaluru_mention, text)) {
    dropped.push("bengaluru_mention");
    out.bengaluru_mention = null;
  }
  out.other_india_cities = out.other_india_cities.filter((c) => canonicalCity(c) && norm(text).includes(norm(c)));

  out.tiers = out.tiers.flatMap((t, i): TierCandidate[] => {
    const p = (f: string) => unsupported.has(`tiers[${i}].${f}`);
    if (!quoteInText(t.evidence, text) || p("tier_type")) {
      dropped.push(`tiers[${i}]`);
      return [];
    }
    const ev = t.evidence;
    const tier = { ...t };
    if (tier.price_inr_min != null && (!quoteSupportsPrice(ev, tier.price_inr_min) || p("price_inr_min"))) { dropped.push(`tiers[${i}].price_inr_min`); tier.price_inr_min = null; }
    if (tier.price_inr_max != null && (!quoteSupportsPrice(ev, tier.price_inr_max) || p("price_inr_max"))) { dropped.push(`tiers[${i}].price_inr_max`); tier.price_inr_max = null; }
    if (tier.sale_start_date && (!quoteSupportsDate(ev, tier.sale_start_date) || p("sale_start_date"))) {
      dropped.push(`tiers[${i}].sale_start`); tier.sale_start_date = null; tier.sale_start_time = null;
    }
    if (tier.sale_start_time && (!quoteSupportsTime(ev, tier.sale_start_time) || p("sale_start_time"))) { dropped.push(`tiers[${i}].sale_start_time`); tier.sale_start_time = null; }
    if (tier.sale_end_date && (!quoteSupportsDate(ev, tier.sale_end_date) || p("sale_end_date"))) {
      dropped.push(`tiers[${i}].sale_end`); tier.sale_end_date = null; tier.sale_end_time = null;
    }
    if (tier.sale_end_time && (!quoteSupportsTime(ev, tier.sale_end_time) || p("sale_end_time"))) { dropped.push(`tiers[${i}].sale_end_time`); tier.sale_end_time = null; }
    if (tier.quantity_note && (!norm(ev).includes(norm(tier.quantity_note).split(" ")[0]) || p("quantity_note"))) { dropped.push(`tiers[${i}].quantity_note`); tier.quantity_note = null; }
    if (tier.availability !== "unknown" && p("availability")) { dropped.push(`tiers[${i}].availability`); tier.availability = "unknown"; tier.field_confidence = "unknown"; }
    return [tier];
  });

  return { candidate: out, report: { rejected: false, reason: null, dropped } };
}
