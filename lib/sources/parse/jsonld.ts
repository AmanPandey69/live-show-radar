import type { Candidate, TierCandidate } from "@/lib/domain/schemas";
import { canonicalCity } from "@/lib/text/cities";
import { utcToIstDate, utcToIstTime } from "@/lib/text/dates-ist";
import { classifyTier } from "@/lib/text/earlybird";

/**
 * schema.org Event JSON-LD → Candidate, with no AI involved.
 * Evidence quotes are exact substrings of the JSON-LD text, so the truthfulness check can verify them.
 */

type Json = Record<string, unknown>;

export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const it of items) if (it && typeof it === "object") out.push(it as Json);
    } catch {
      /* malformed block: skip */
    }
  }
  return out;
}

const EVENT_TYPES = new Set(["Event", "MusicEvent", "Festival", "ComedyEvent", "TheaterEvent"]);
export const isEvent = (j: Json) => {
  const t = j["@type"];
  return Array.isArray(t) ? t.some((x) => EVENT_TYPES.has(String(x))) : EVENT_TYPES.has(String(t));
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Quote: the shortest JSON fragment `"key":"value"` as it would appear in compact JSON. */
const q = (key: string, value: unknown) => `"${key}": ${JSON.stringify(value)}`;

function addressText(loc: Json | undefined): string | null {
  if (!loc) return null;
  const a = loc.address;
  if (typeof a === "string") return a;
  if (a && typeof a === "object") {
    const o = a as Json;
    return [o.streetAddress, o.addressLocality, o.addressRegion, o.postalCode].filter((x) => typeof x === "string").join(", ") || null;
  }
  return null;
}

const AVAIL: Record<string, TierCandidate["availability"]> = {
  InStock: "open", LimitedAvailability: "open", OnlineOnly: "open", InStoreOnly: "open",
  SoldOut: "sold_out", OutOfStock: "sold_out", Discontinued: "closed", PreOrder: "upcoming", PreSale: "upcoming",
};

function offerTiers(offers: unknown, eventStartIso: string | null, now: Date): TierCandidate[] {
  const list: Json[] = [];
  const push = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const j = o as Json;
    if (Array.isArray(j.offers)) j.offers.forEach(push);
    else if (j["@type"] === "AggregateOffer" && j.offers) push(j.offers);
    else list.push(j);
  };
  if (Array.isArray(offers)) offers.forEach(push);
  else push(offers);

  return list.flatMap((o): TierCandidate[] => {
    const name = str(o.name) ?? str(o.category) ?? "Tickets";
    const availRaw = String(o.availability ?? "").split("/").pop() ?? "";
    let availability = AVAIL[availRaw] ?? "unknown";
    const price = typeof o.price === "number" ? o.price : Number(o.price);
    const validFrom = str(o.validFrom);
    let sale_start_date: string | null = null;
    let sale_start_time: string | null = null;
    if (validFrom && Date.parse(validFrom) > now.getTime()) {
      sale_start_date = utcToIstDate(new Date(validFrom).toISOString());
      sale_start_time = utcToIstTime(new Date(validFrom).toISOString());
      if (availability === "unknown" || availability === "open") availability = "upcoming";
    }
    // `availabilityEnds` equal to the show start is NOT an early-bird deadline (District sets it on every tier).
    const ends = str(o.availabilityEnds);
    let sale_end_date: string | null = null;
    let sale_end_time: string | null = null;
    if (ends && (!eventStartIso || Math.abs(Date.parse(ends) - Date.parse(eventStartIso)) > 3 * 3_600_000)) {
      sale_end_date = utcToIstDate(new Date(ends).toISOString());
      sale_end_time = utcToIstTime(new Date(ends).toISOString());
    }
    const evidenceParts = [q("name", name)];
    if (o.availability) evidenceParts.push(q("availability", o.availability));
    if (sale_start_date && validFrom) evidenceParts.push(q("validFrom", validFrom));
    if (sale_end_date && ends) evidenceParts.push(q("availabilityEnds", ends));
    if (o.price != null) evidenceParts.push(q("price", o.price));
    return [{
      tier_type: classifyTier(name) ?? "general",
      name_raw: name,
      price_inr_min: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
      price_inr_max: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
      sale_start_date, sale_start_time, sale_end_date, sale_end_time,
      quantity_note: availRaw === "LimitedAvailability" ? "limited availability" : null,
      availability,
      evidence: evidenceParts.join(" … "), // fragments are checked independently by the truth gate
      field_confidence: "confirmed",
    }];
  });
}

export function jsonLdToCandidate(ev: Json, pageUrl: string, now: Date = new Date()): Candidate | null {
  const name = str(ev.name);
  const start = str(ev.startDate);
  const loc = (Array.isArray(ev.location) ? ev.location[0] : ev.location) as Json | undefined;
  const venue = loc ? str(loc.name) : null;
  const addr = addressText(loc);
  const city = canonicalCity(addr) ?? canonicalCity(venue) ?? canonicalCity(name);
  const cityEvidence = canonicalCity(addr) ? q("address", addr) : canonicalCity(venue) ? q("name", venue) : q("name", name);
  if (!name || !city) return null; // not India (or unknown city): out of scope

  const hasTime = !!start && /T\d{2}:\d{2}/.test(start);
  const startIso = start ? new Date(start).toISOString() : null;
  const status = String(ev.eventStatus ?? "").split("/").pop();
  const performers = (Array.isArray(ev.performer) ? ev.performer : ev.performer ? [ev.performer] : []) as Json[];
  const tiers = offerTiers(ev.offers, startIso, now);
  const offersUrl = (() => {
    const o = ev.offers as Json | undefined;
    return str(o?.url) ?? str(((o?.offers as Json[] | undefined) ?? [])[0]?.url) ?? null;
  })();
  const festival = /festival|fest\b|weekender/i.test(name) || ev["@type"] === "Festival";

  return {
    artists: performers.filter((p) => str(p.name)).map((p) => ({ name: str(p.name)!, role: "headliner" as const, evidence: q("name", p.name) })),
    title: name,
    is_festival: festival,
    festival_name: festival ? name : null,
    venue,
    venue_evidence: venue ? q("name", venue) : null,
    city,
    city_evidence: cityEvidence,
    date: startIso ? (hasTime ? utcToIstDate(startIso) : start!.slice(0, 10)) : null,
    date_evidence: start ? q("startDate", start) : null,
    show_time: startIso && hasTime ? utcToIstTime(startIso) : null,
    doors_time: str(ev.doorTime) ? utcToIstTime(new Date(String(ev.doorTime)).toISOString()) : null,
    time_evidence: start && hasTime ? q("startDate", start) : null,
    status_signal: status === "EventCancelled" ? "cancelled" : status === "EventPostponed" || status === "EventRescheduled" ? "postponed" : "none",
    status_evidence: status && status !== "EventScheduled" ? q("eventStatus", ev.eventStatus) : null,
    ticket_url: offersUrl ?? str(ev.url) ?? pageUrl,
    tiers,
    other_india_cities: [],
    bengaluru_mention: null,
  };
}
