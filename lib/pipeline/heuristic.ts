import type { Candidate, TierCandidate } from "@/lib/domain/schemas";
import { citiesIn } from "@/lib/text/cities";
import { parseDoorsAndShow, parseIndianDate } from "@/lib/text/dates-ist";
import { findTierPhrases } from "@/lib/text/earlybird";
import type { ArtistMatch } from "@/lib/text/match";

/**
 * Deterministic fallback extractor: used when Gemini is disabled, over budget, rate-limited or invalid.
 * Conservative: one candidate per text, only facts with a quotable sentence. Never fills gaps.
 */

function sentenceWith(text: string, needle: string): string | null {
  const parts = text.split(/(?<=[.!?\n])\s+|\n+/);
  const hit = parts.find((s) => s.toLowerCase().includes(needle.toLowerCase()));
  return hit ? hit.trim().slice(0, 400) : null;
}

const VENUE_RE = /\b(?:at|@|venue[:\s-]+)\s+((?:the\s+)?[A-Z][\w'’&.-]*(?:\s+(?:[A-Z][\w'’&.-]*|of|at|@|the)){0,5})/;
const STOP_VENUE = /^(?:the\s+)?(?:\d|Mon|Tue|Wed|Thu|Fri|Sat|Sun|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|IST|Bengaluru|Bangalore|Mumbai|Delhi|India)\b/;

export function heuristicExtract(text: string, matches: ArtistMatch[], now: Date): Candidate | null {
  const artists = matches.filter((m) => !m.blocked);
  if (artists.length === 0) return null;
  const cities = citiesIn(text, { strict: true });
  if (cities.length === 0) return null;
  const city = cities[0];
  const cityEvidence = sentenceWith(text, city === "Bengaluru" && !/bengaluru/i.test(text) ? "bangalore" : city) ?? sentenceWith(text, city.split(" ")[0]);
  if (!cityEvidence) return null;

  // Date: first date in a sentence that mentions a show word (avoid sale dates being taken as show dates).
  let date: string | null = null;
  let dateEvidence: string | null = null;
  for (const s of text.split(/(?<=[.!?\n])\s+|\n+/)) {
    if (/\b(early|presale|pre-sale|sale|tickets? (?:go|open)|opens?|till|until|deadline)\b/i.test(s)) continue;
    const d = parseIndianDate(s, now);
    if (d && d.date >= now.toISOString().slice(0, 10)) {
      date = d.date;
      dateEvidence = s.trim().slice(0, 400);
      break;
    }
  }
  const { doors, show } = dateEvidence ? parseDoorsAndShow(dateEvidence) : { doors: null, show: null };

  let venue: string | null = null;
  let venueEvidence: string | null = null;
  const vm = VENUE_RE.exec(text);
  if (vm && !STOP_VENUE.test(vm[1])) {
    venue = vm[1].replace(/[,.;:]+$/, "").trim();
    venueEvidence = sentenceWith(text, venue);
  }

  const tiers: TierCandidate[] = findTierPhrases(text, now)
    .filter((s) => s.tier_type)
    .map((s) => {
      const statedEndTime = s.sale_end && /11[:.]59|23:59|midnight/i.test(s.evidence) ? s.sale_end.time : null;
      const price = /(?:₹|rs\.?|inr)\s*([\d,]{2,7})/i.exec(s.evidence);
      const p = price ? Number(price[1].replace(/,/g, "")) : null;
      return {
        tier_type: s.tier_type!,
        name_raw: s.name_raw,
        price_inr_min: p, price_inr_max: p,
        sale_start_date: s.sale_start?.date ?? null,
        sale_start_time: s.sale_start?.time ?? null,
        sale_end_date: s.sale_end?.date ?? null,
        sale_end_time: statedEndTime,
        quantity_note: s.quantity_note,
        availability: s.availability,
        evidence: s.evidence,
        field_confidence: s.availability_basis === "stated" ? "confirmed" : s.availability_basis === "inferred" ? "inferred" : "unknown",
      };
    });

  const status = /\bcancell?ed\b/i.test(text) ? "cancelled" : /\bpostponed\b|\brescheduled\b/i.test(text) ? "postponed" : /\bsold[\s-]*out\b/i.test(text) && tiers.length === 0 ? "sold_out" : "none";
  const statusEvidence = status === "none" ? null : sentenceWith(text, status === "sold_out" ? "sold" : status === "cancelled" ? "cancel" : status === "postponed" && /postponed/i.test(text) ? "postponed" : "rescheduled");

  return {
    artists: artists.map((a) => ({ name: a.alias, role: a.role, evidence: a.evidence })),
    title: text.split("\n")[0].slice(0, 200),
    is_festival: /\bfestival\b|\bfest\b|\bweekender\b/i.test(text),
    festival_name: null,
    venue, venue_evidence: venueEvidence,
    city, city_evidence: cityEvidence,
    date, date_evidence: dateEvidence,
    show_time: show, doors_time: doors, time_evidence: show || doors ? dateEvidence : null,
    status_signal: status, status_evidence: statusEvidence,
    ticket_url: null,
    tiers,
    other_india_cities: cities.slice(1),
    bengaluru_mention: null,
  };
}
