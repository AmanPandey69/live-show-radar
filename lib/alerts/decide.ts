import type { AlertType, Priority, TicketTier } from "@/lib/domain/types";
import type { Snapshot } from "@/lib/pipeline/merge";
import { norm } from "@/lib/text/normalize";

/**
 * Turn a before/after snapshot into alert facts. Alerts fire on TRANSITIONS, and each fact has a stable
 * dedupe key, so a fact is alerted at most once even if a source flaps (open → unknown → open).
 */
export interface AlertFact { type: AlertType; key: string; summary: string }

const EARLY = new Set(["early_bird", "phase_1"]);
const isPresale = (t: TicketTier) => t.tier_type === "presale_card" || t.tier_type === "presale_membership";
const tierKey = (t: TicketTier) => `${t.tier_type}:${norm(t.name_raw)}`;

export function decideAlerts(before: Snapshot | null, after: Snapshot, now: Date = new Date()): AlertFact[] {
  const e = after.event;
  const id = e.id;
  const facts: AlertFact[] = [];
  if (!before) {
    facts.push({ type: "NEW_SHOW", key: `${id}|NEW_SHOW`, summary: "New show announced" });
  }
  const prevTier = (t: TicketTier) => before?.tiers.find((p) => tierKey(p) === tierKey(t)) ?? null;
  const future = (iso: string | null) => !!iso && Date.parse(iso) > now.getTime();

  for (const t of after.tiers) {
    const p = prevTier(t);
    if (EARLY.has(t.tier_type)) {
      if (t.availability === "open" && p?.availability !== "open") {
        facts.push({ type: "EARLY_BIRD_OPEN", key: `${id}|EB_OPEN|${tierKey(t)}`, summary: `${t.name_raw} is open` });
      }
      if (t.availability === "upcoming" && future(t.sale_start_at) && t.sale_start_at !== p?.sale_start_at) {
        facts.push({ type: "EARLY_BIRD_IMMINENT", key: `${id}|EB_IMMINENT|${tierKey(t)}|${t.sale_start_at}`, summary: `${t.name_raw} opening time announced` });
      }
      if (t.availability === "open" && future(t.sale_end_at) && t.sale_end_at !== p?.sale_end_at) {
        facts.push({ type: "EARLY_BIRD_CLOSING", key: `${id}|EB_CLOSING|${tierKey(t)}|${t.sale_end_at}`, summary: `${t.name_raw} deadline announced` });
      } else if (t.availability === "open" && t.quantity_note && t.quantity_note !== p?.quantity_note) {
        facts.push({ type: "EARLY_BIRD_CLOSING", key: `${id}|EB_LIMITED|${tierKey(t)}|${norm(t.quantity_note)}`, summary: `${t.name_raw}: ${t.quantity_note}` });
      }
      if ((t.availability === "sold_out" || t.availability === "closed") && p && p.availability !== t.availability) {
        facts.push({ type: "UPDATE", key: `${id}|EB_${t.availability.toUpperCase()}|${tierKey(t)}`, summary: `${t.name_raw} ${t.availability.replace("_", " ")}` });
      }
    } else if (isPresale(t)) {
      if ((t.availability === "open" || t.availability === "upcoming") && t.availability !== p?.availability) {
        facts.push({ type: "PRESALE", key: `${id}|PRESALE|${tierKey(t)}|${t.availability}|${t.sale_start_at ?? ""}`, summary: `${t.name_raw} ${t.availability === "open" ? "is open" : "announced"}` });
      }
    } else if (!p && before) {
      facts.push({ type: "UPDATE", key: `${id}|TIER|${tierKey(t)}|${t.availability}`, summary: `New ticket tier: ${t.name_raw}` });
    } else if (p && p.availability !== t.availability && t.availability === "open" && before) {
      facts.push({ type: "UPDATE", key: `${id}|TIER_OPEN|${tierKey(t)}`, summary: `${t.name_raw} on sale` });
    }
  }

  if (before) {
    const b = before.event;
    if (e.status !== b.status) {
      if (e.status === "cancelled") facts.push({ type: "CANCELLED", key: `${id}|CANCELLED`, summary: "Show cancelled" });
      else if (e.status === "postponed") facts.push({ type: "POSTPONED", key: `${id}|POSTPONED|${e.start_date_local}`, summary: "Show postponed" });
      else if (e.status === "sold_out") facts.push({ type: "SOLD_OUT", key: `${id}|SOLD_OUT`, summary: "Sold out" });
    }
    if (b.start_date_local && e.start_date_local !== b.start_date_local) {
      facts.push({ type: "CHANGED", key: `${id}|CHANGED|date|${e.start_date_local}`, summary: `Date changed: ${b.start_date_local} → ${e.start_date_local}` });
    } else if (b.start_at && e.start_at && e.start_at !== b.start_at) {
      facts.push({ type: "CHANGED", key: `${id}|CHANGED|time|${e.start_at}`, summary: "Show time changed" });
    }
    if (b.venue_name_raw && e.venue_name_raw && norm(e.venue_name_raw) !== norm(b.venue_name_raw)) {
      facts.push({ type: "CHANGED", key: `${id}|CHANGED|venue|${norm(e.venue_name_raw)}`, summary: `Venue changed: ${b.venue_name_raw} → ${e.venue_name_raw}` });
    }
    if (b.confidence !== "confirmed" && e.confidence === "confirmed") {
      facts.push({ type: "UPDATE", key: `${id}|CONFIRMED`, summary: "Now confirmed by an official/second source" });
    }
    if (!b.start_date_local && e.start_date_local) {
      facts.push({ type: "UPDATE", key: `${id}|DATE_KNOWN|${e.start_date_local}`, summary: "Date announced" });
    }
  }
  return facts;
}

const SEVERITY: AlertType[] = ["CANCELLED", "POSTPONED", "CHANGED", "EARLY_BIRD_OPEN", "EARLY_BIRD_CLOSING", "EARLY_BIRD_IMMINENT", "PRESALE", "NEW_SHOW", "SOLD_OUT", "UPDATE", "REMINDER"];

/** Headline type for a bundle of facts sent as one message. NEW_SHOW stays the headline for new events. */
export function headlineType(facts: AlertFact[]): AlertType {
  if (facts.some((f) => f.type === "NEW_SHOW")) return "NEW_SHOW";
  return [...facts].sort((a, b) => SEVERITY.indexOf(a.type) - SEVERITY.indexOf(b.type))[0]?.type ?? "UPDATE";
}

/** Cancellations/changes of a P0/P1 event are always urgent. */
export function alertPriority(eventPriority: Priority, type: AlertType): Priority {
  if ((type === "CANCELLED" || type === "POSTPONED" || type === "CHANGED") && eventPriority === "P2") return "P1";
  return eventPriority;
}
