import travel from "@/config/travel-from-bengaluru.json";
import type { AlertType, Artist, EventRow, EventSource, TicketTier } from "@/lib/domain/types";
import { isHomeCity } from "@/lib/text/cities";
import { formatIst, formatIstDate, humanizeDuration } from "@/lib/text/dates-ist";

/**
 * Deterministic alert rendering for the email alert and the in-app log.
 * Every ticket fact shown is confirmed (quoted), labelled inferred, or explicitly "not stated".
 */

const EARLY = new Set(["early_bird", "phase_1"]);
const PRESALE = new Set(["presale_card", "presale_membership"]);

const deadlineText = (t: TicketTier) => {
  if (!t.sale_end_at) return null;
  const inferredTime = t.field_confidence === "inferred" && /T18:29:00/.test(t.sale_end_at); // 23:59 IST default
  return inferredTime ? `closes ${formatIst(t.sale_end_at, { withTime: false })} (time not stated)` : `closes ${formatIst(t.sale_end_at)}`;
};
const inferredTag = (t: TicketTier) => (t.field_confidence === "inferred" ? " (inferred)" : "");

/** The single most important ticket line, e.g. "EARLY-BIRD OPEN NOW, closes Fri 15 Nov, 11:59pm IST". */
export function ticketStatusLine(tiers: TicketTier[], now: Date = new Date()): string {
  const early = tiers.filter((t) => EARLY.has(t.tier_type));
  const pre = tiers.filter((t) => PRESALE.has(t.tier_type));
  const label = (t: TicketTier) => (t.tier_type === "phase_1" ? "PHASE-1 (early tier)" : "EARLY-BIRD");

  const open = early.find((t) => t.availability === "open");
  if (open) {
    const d = deadlineText(open);
    if (d) return `${label(open)} OPEN NOW, ${d}${inferredTag(open)}`;
    if (open.quantity_note) return `${label(open)} OPEN NOW · LIMITED early-bird window (“${open.quantity_note}”), deadline not stated`;
    return `${label(open)} OPEN NOW${inferredTag(open)}, deadline not stated`;
  }
  const soon = early.find((t) => t.availability === "upcoming");
  if (soon) {
    if (soon.sale_start_at) {
      const ms = Date.parse(soon.sale_start_at) - now.getTime();
      return ms > 0 ? `${label(soon)} OPENS ${formatIst(soon.sale_start_at)} (in ${humanizeDuration(ms)})` : `${label(soon)} should be open now (opened ${formatIst(soon.sale_start_at)}), check the link`;
    }
    return `${label(soon)} announced, opening time not stated`;
  }
  const preOpen = pre.find((t) => t.availability === "open" || t.availability === "upcoming");
  if (preOpen) {
    const who = preOpen.tier_type === "presale_card" ? "card presale" : "member presale";
    if (preOpen.availability === "open") return `PRESALE OPEN NOW (${who}: “${preOpen.name_raw}”)${deadlineText(preOpen) ? `, ${deadlineText(preOpen)}` : ""}`;
    if (preOpen.sale_start_at) {
      const ms = Date.parse(preOpen.sale_start_at) - now.getTime();
      return `PRESALE OPENS ${formatIst(preOpen.sale_start_at)}${ms > 0 ? ` (in ${humanizeDuration(ms)})` : ""} (${who}: “${preOpen.name_raw}”)`;
    }
    return `PRESALE announced (${who}: “${preOpen.name_raw}”), time not stated`;
  }
  const gone = early.find((t) => t.availability === "sold_out" || t.availability === "closed");
  const general = tiers.find((t) => !EARLY.has(t.tier_type) && !PRESALE.has(t.tier_type) && t.availability === "open");
  if (gone) return `Early-bird ${gone.availability === "sold_out" ? "SOLD OUT" : "closed"}${general ? " · general tickets on sale" : ""}`;
  if (early.length) return `Early-bird tier listed (“${early[0].name_raw}”), availability not stated, check the link`;
  if (general) return "Early-bird: not stated, check the link · tickets on sale";
  return "Early-bird: not stated, check the link";
}

export interface RenderInput {
  type: AlertType;
  facts: string[];
  event: EventRow;
  tiers: TicketTier[];
  sources: EventSource[];
  artists: Artist[];
  homeCity: string;
  why: string;
  appBaseUrl: string;
  now?: Date;
  demo?: boolean;
  otherIndiaEvents?: { city: string; date: string | null }[];
}

export interface RenderedAlert {
  title: string;
  lines: string[];
  html: string; // simple HTML (in-app / logs)
  text: string; // plain text (email text part, logs)
  ticketUrl: string | null;
  eventUrl: string;
  unconfirmed: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const TYPE_LABEL: Record<AlertType, string> = {
  NEW_SHOW: "NEW SHOW", EARLY_BIRD_OPEN: "EARLY-BIRD OPEN", EARLY_BIRD_IMMINENT: "EARLY-BIRD SOON", EARLY_BIRD_CLOSING: "EARLY-BIRD CLOSING",
  PRESALE: "PRESALE", CHANGED: "CHANGED", CANCELLED: "CANCELLED", POSTPONED: "POSTPONED", SOLD_OUT: "SOLD OUT", UPDATE: "UPDATE",
  REMINDER: "REMINDER", DIGEST: "DIGEST",
};

export function artistNames(event: EventRow, artists: Artist[]) {
  const name = (id: string) => artists.find((a) => a.id === id)?.name ?? "Unknown artist";
  const heads = event.headliner_ids.map(name);
  const sups = event.support_ids.map(name);
  return heads.join(" + ") + (sups.length ? ` (support: ${sups.join(", ")})` : "");
}

export function detectionLine(event: EventRow, now: Date): string {
  const sign = event.first_public_at ?? null;
  if (!sign) return "Detected by Radar just now (source publish time not given)";
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(sign)) / 60000));
  return `Detected ${mins < 120 ? `${mins} minutes` : humanizeDuration(mins * 60000)} after first public sign`;
}

export function decisionCard(i: Pick<RenderInput, "event" | "tiers" | "homeCity" | "otherIndiaEvents">, now: Date): string[] {
  const e = i.event;
  if (isHomeCity(e.city, i.homeCity)) return [];
  const lines: string[] = [];
  const t = (travel as Record<string, { road_km: number; flight: string | null; ground: string } | string>)[e.city];
  const days = (iso: string | null) => (iso ? Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000) : null);
  const showDays = e.start_date_local ? days(`${e.start_date_local}T00:00:00+05:30`) : null;
  const sale = i.tiers.map((x) => x.sale_start_at).filter((x): x is string => !!x && Date.parse(x) > now.getTime()).sort()[0] ?? null;
  lines.push(`Show in ${showDays ?? "?"} days${sale ? ` · sale opens in ${humanizeDuration(Date.parse(sale) - now.getTime())}` : ""}`);
  if (t && typeof t === "object") lines.push(`From Bengaluru (approx.): ${t.flight ? `flight ${t.flight}` : "no direct flight"} · ${t.ground} · ~${t.road_km} km`);
  const others = [...new Set([...(i.otherIndiaEvents ?? []).map((o) => o.city), ...e.tour_other_cities])].filter((c) => c !== e.city);
  if (others.length) lines.push(`Same tour also lists: ${others.join(", ")}`);
  if (e.bengaluru_note) lines.push(`Bengaluru: source says “${e.bengaluru_note.text}”`);
  else lines.push("Bengaluru date: none mentioned by any source");
  return lines;
}

export function renderAlert(i: RenderInput): RenderedAlert {
  const now = i.now ?? new Date();
  const e = i.event;
  const unconfirmed = e.confidence !== "confirmed";
  const venue = e.venue_name_raw ?? "Venue not stated";
  const when = e.start_at ? formatIst(e.start_at, { withYear: true }) : e.start_date_local ? `${formatIstDate(e.start_date_local)} (time not stated)` : "Date not stated";
  const doors = e.doors_at ? ` (doors ${formatIst(e.doors_at).split(", ")[1]})` : "";
  const primary = i.sources.filter((s) => s.is_primary);
  const srcList = [...new Map(i.sources.map((s) => [host(s.url), s])).values()].slice(0, 4).map((s) => `${host(s.url)}${s.is_primary ? " (official)" : ""}`);
  const ticketUrl = e.ticket_url ?? primary[0]?.url ?? null;
  const eventUrl = `${i.appBaseUrl.replace(/\/$/, "")}/event/${e.id}`;
  const tag = `${i.demo ? "[DEMO] " : ""}${unconfirmed ? (e.confidence === "rumoured" ? "RUMOUR · " : "UNCONFIRMED · ") : ""}${TYPE_LABEL[i.type]} · ${e.priority}`;
  const title = `${tag}: ${artistNames(e, i.artists)} in ${e.city}`;

  const lines = [
    `${artistNames(e, i.artists)}`,
    `${venue}, ${e.city}`,
    `${when}${doors}`,
    `Tickets: ${ticketStatusLine(i.tiers, now)}`,
    ...(i.facts.length > 1 || i.type !== "NEW_SHOW" ? [`What changed: ${i.facts.join("; ")}`] : []),
    ...decisionCard(i, now),
    `Sources: ${srcList.join(", ") || "none"}`,
    detectionLine(e, now),
    `Why it matters: ${i.why}`,
  ];
  if (unconfirmed) lines.splice(1, 0, "⚠ Single non-official source. Verify on the ticket link before paying.");

  const html = [
    `<b>${esc(tag)}</b>`,
    `<b>${esc(lines[0])}</b>`,
    ...lines.slice(1).map((l) => (l.startsWith("Tickets:") ? `🎟 <b>${esc(l)}</b>` : esc(l))),
    ticketUrl ? `<a href="${esc(ticketUrl)}">Open tickets</a> · <a href="${esc(eventUrl)}">Details & evidence</a>` : `<a href="${esc(eventUrl)}">Details & evidence</a>`,
  ].join("\n");
  const text = [title, ...lines, ticketUrl ? `Tickets: ${ticketUrl}` : "", `Details: ${eventUrl}`].filter(Boolean).join("\n");
  return { title, lines, html, text, ticketUrl, eventUrl, unconfirmed };
}

/** Deterministic "why it matters" (used when Gemini is off or for P2). */
export function defaultWhy(e: EventRow, tiers: TicketTier[], affinityLabel: string, capacity: number | null, homeCity: string): string {
  const parts: string[] = [];
  parts.push(affinityLabel === "must_see" ? "Must-see artist" : affinityLabel === "like" ? "Artist you like" : "Artist you follow");
  if (isHomeCity(e.city, homeCity)) parts.push("playing your city");
  if (capacity) parts.push(`~${capacity}-capacity venue (approx.)`);
  if (tiers.some((t) => EARLY.has(t.tier_type) && (t.availability === "open" || t.availability === "upcoming"))) parts.push("early-bird passes typically go within ~6 hours");
  return parts.join(", ") + ".";
}
