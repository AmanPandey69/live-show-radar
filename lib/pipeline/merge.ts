import type { Repo } from "@/lib/db/repo";
import type { Candidate, TierCandidate } from "@/lib/domain/schemas";
import { canTransition, corroborate, deriveStatus, effectiveAffinity, fingerprint, isPrimaryUrl, isSameShow, priorityFor, urgencyScore } from "@/lib/domain/rules";
import type { Affinity, Artist, Conflict, EventRow, EventStatus, TicketTier, Venue } from "@/lib/domain/types";
import { canonicalCity } from "@/lib/text/cities";
import { istToUtc } from "@/lib/text/dates-ist";
import { norm, tokenSimilarity } from "@/lib/text/normalize";

export interface Snapshot { event: EventRow; tiers: TicketTier[] }

export interface MergeInput {
  candidate: Candidate;
  headliner_ids: string[];
  support_ids: string[];
  source_id: string;
  url: string;
  is_primary: boolean;
  snippet: string;
  observation_id: string | null;
  published_at: string | null;
  is_demo: boolean;
  image_url?: string | null;
}

export interface MergeResult { before: Snapshot | null; after: Snapshot; isNew: boolean }

const dayShift = (date: string, d: number) => new Date(Date.parse(date) + d * 86_400_000).toISOString().slice(0, 10);

function tierToRow(t: TierCandidate, event_id: string, url: string): Omit<TicketTier, "id" | "updated_at"> {
  const start = t.sale_start_date ? istToUtc(t.sale_start_date, t.sale_start_time ?? "00:00") : null;
  // A deadline without a stated time is stored as end of day IST and labelled inferred.
  const end = t.sale_end_date ? istToUtc(t.sale_end_date, t.sale_end_time ?? "23:59") : null;
  const inferredTime = (!!t.sale_end_date && !t.sale_end_time) || (!!t.sale_start_date && !t.sale_start_time);
  return {
    event_id,
    tier_type: t.tier_type,
    name_raw: t.name_raw,
    price_inr_min: t.price_inr_min,
    price_inr_max: t.price_inr_max,
    sale_start_at: start,
    sale_end_at: end,
    quantity_note: t.quantity_note,
    availability: t.availability,
    source_url: url,
    evidence_snippet: t.evidence,
    field_confidence: t.field_confidence === "confirmed" && inferredTime ? "inferred" : t.field_confidence,
  };
}

async function resolveVenue(repo: Repo, name: string | null, city: string): Promise<Venue | null> {
  if (!name) return null;
  const venues = await repo.listVenues();
  const c = canonicalCity(city) ?? city;
  return (
    venues.find((v) => (canonicalCity(v.city) ?? v.city) === c && [v.name, ...v.aliases].some((n) => tokenSimilarity(n, name) >= 0.6)) ?? null
  );
}

export async function bestAffinity(artistIds: string[], artists: Artist[]): Promise<Affinity> {
  const order: Affinity[] = ["must_see", "like", "casual"];
  const tiers = artists.filter((a) => artistIds.includes(a.id)).map(effectiveAffinity);
  return order.find((o) => tiers.includes(o)) ?? "casual";
}

/** Recompute derived fields (confidence, status, priority, urgency) from everything stored for the event. */
export async function recompute(repo: Repo, event: EventRow, artists: Artist[], homeCity: string, explicit: EventStatus | null, now: Date): Promise<EventRow> {
  const sources = await repo.listEventSources([event.id]);
  const tiers = await repo.listTiers([event.id]);
  const confidence = event.confidence === "confirmed" ? "confirmed" : corroborate(sources.map((s) => ({ url: s.url, is_primary: s.is_primary, source_id: s.source_id })));
  const status = deriveStatus(event.status, tiers, explicit, confidence);
  const venue = event.venue_id ? (await repo.listVenues()).find((v) => v.id === event.venue_id) : null;
  const affinity = await bestAffinity([...event.headliner_ids, ...event.support_ids], artists);
  const priority = priorityFor({ city: event.city, home_city: homeCity, affinity, tiers });
  const urgency = urgencyScore({
    city: event.city, home_city: homeCity, affinity, tiers, capacity_approx: venue?.capacity_approx ?? null,
    announced_at: event.first_public_at ?? event.first_seen_at, now,
  });
  const patch: Partial<EventRow> = { confidence, priority, urgency };
  if (canTransition(event.status, status)) patch.status = status;
  else patch.conflicts = [...event.conflicts, { field: "status", values: [{ value: status, source_url: "", snippet: `ignored transition ${event.status}→${status}` }] }];
  await repo.updateEvent(event.id, patch);
  return { ...event, ...patch };
}

/**
 * Find-or-create the canonical event for a candidate and fold in its facts with provenance.
 * Conflicts (a non-primary source disagreeing with stored values) are kept and flagged, not applied.
 */
export async function mergeCandidate(repo: Repo, m: MergeInput, artists: Artist[], homeCity: string, now: Date): Promise<MergeResult> {
  const c = m.candidate;
  const city = canonicalCity(c.city) ?? c.city;
  const date = c.date;
  const near = await repo.findEventsNear(city, date ? dayShift(date, -1) : null, date ? dayShift(date, 1) : null);
  const dedupe = { headliner_ids: m.headliner_ids, support_ids: m.support_ids, city, start_date_local: date, venue_name_raw: c.venue, festival_name: c.festival_name };
  const matches = near.filter((e) => e.is_demo === m.is_demo && isSameShow(dedupe, e, near.filter((x) => x.id !== e.id && x.headliner_ids.some((h) => m.headliner_ids.includes(h))).map((x) => x.start_date_local!).filter(Boolean)));
  // Prefer exact date, then the event whose date is known.
  matches.sort((a, b) => Number(b.start_date_local === date) - Number(a.start_date_local === date));
  let existing: EventRow | null = matches[0] ?? null;
  // Undated candidate vs several dated events: ambiguous, attach only if exactly one.
  if (!date && matches.length > 1) existing = null;

  const venue = await resolveVenue(repo, c.venue, city);
  const startAt = date && c.show_time ? istToUtc(date, c.show_time) : null;
  const doorsAt = date && c.doors_time ? istToUtc(date, c.doors_time) : null;
  const startLocal = date ? `${date}${c.show_time ? ` ${c.show_time}` : ""}` : null;
  const explicit: EventStatus | null = c.status_signal === "cancelled" ? "cancelled" : c.status_signal === "postponed" ? "postponed" : c.status_signal === "sold_out" ? "sold_out" : c.status_signal === "rumoured" ? "rumoured" : null;

  let before: Snapshot | null = null;
  let event: EventRow;
  let isNew = false;

  if (!existing) {
    const fp = fingerprint(m.headliner_ids.length ? m.headliner_ids : m.support_ids, city, date) + (m.is_demo ? "|demo" : "");
    const clash = (await repo.findEventsNear(city, null, null)).find((e) => e.fingerprint === fp);
    if (clash) existing = clash;
    else {
      event = await repo.insertEvent({
        fingerprint: fp,
        title: c.title,
        headliner_ids: m.headliner_ids,
        support_ids: m.support_ids,
        is_festival: c.is_festival,
        festival_name: c.festival_name,
        venue_id: venue?.id ?? null,
        venue_name_raw: c.venue,
        city,
        start_at: startAt,
        start_date_local: date,
        start_local: startLocal,
        doors_at: doorsAt,
        status: "announced",
        confidence: m.is_primary ? "confirmed" : "unconfirmed",
        ticket_url: c.ticket_url ?? (m.is_primary ? m.url : null),
        image_url: m.image_url ?? null,
        tour_other_cities: c.other_india_cities.map((x) => canonicalCity(x) ?? x).filter((x) => x !== city),
        bengaluru_note: c.bengaluru_mention ? { text: c.bengaluru_mention, url: m.url, snippet: c.bengaluru_mention } : null,
        conflicts: [],
        urgency: 0,
        priority: "P2",
        first_seen_at: now.toISOString(),
        first_public_at: m.published_at,
        first_source_id: m.source_id,
        last_changed_at: now.toISOString(),
        is_demo: m.is_demo,
      });
      isNew = true;
    }
  }

  if (existing) {
    before = { event: existing, tiers: await repo.listTiers([existing.id]) };
    event = existing;
    const patch: Partial<EventRow> = {};
    const conflicts: Conflict[] = [...existing.conflicts];
    const trustNew = m.is_primary || !(await repo.listEventSources([existing.id])).some((s) => s.is_primary);
    const setOrConflict = <K extends keyof EventRow>(field: K, value: EventRow[K], evidenceSnippet: string) => {
      const cur = existing![field];
      if (value == null || value === cur) return;
      if (cur == null || trustNew) patch[field] = value;
      else conflicts.push({ field: String(field), values: [{ value: cur, source_url: "(stored)", snippet: "" }, { value, source_url: m.url, snippet: evidenceSnippet }] });
    };
    setOrConflict("start_date_local", date, c.date_evidence ?? "");
    if (date) setOrConflict("start_at", startAt, c.time_evidence ?? "");
    if (date) setOrConflict("start_local", startLocal, c.time_evidence ?? "");
    setOrConflict("doors_at", doorsAt, c.time_evidence ?? "");
    if (c.venue && (!existing.venue_name_raw || norm(c.venue) !== norm(existing.venue_name_raw))) {
      // Same venue spelled differently is not a change.
      if (!existing.venue_name_raw || tokenSimilarity(c.venue, existing.venue_name_raw) < 0.5) setOrConflict("venue_name_raw", c.venue, c.venue_evidence ?? "");
      if (venue && !existing.venue_id) patch.venue_id = venue.id;
    }
    if (!existing.ticket_url && (c.ticket_url || m.is_primary)) patch.ticket_url = c.ticket_url ?? m.url;
    if (m.image_url && (!existing.image_url || (m.is_primary && existing.image_url !== m.image_url && /district\.in/.test(m.image_url)))) patch.image_url = m.image_url;
    if (m.is_primary && c.ticket_url && existing.ticket_url && !isPrimaryUrl(existing.ticket_url)) patch.ticket_url = c.ticket_url;
    const heads = [...new Set([...existing.headliner_ids, ...m.headliner_ids])];
    const sups = [...new Set([...existing.support_ids, ...m.support_ids])].filter((x) => !heads.includes(x));
    if (heads.length !== existing.headliner_ids.length) patch.headliner_ids = heads;
    if (sups.length !== existing.support_ids.length) patch.support_ids = sups;
    const others = [...new Set([...existing.tour_other_cities, ...c.other_india_cities.map((x) => canonicalCity(x) ?? x)])].filter((x) => x !== existing!.city);
    if (others.length !== existing.tour_other_cities.length) patch.tour_other_cities = others;
    if (!existing.bengaluru_note && c.bengaluru_mention) patch.bengaluru_note = { text: c.bengaluru_mention, url: m.url, snippet: c.bengaluru_mention };
    if (m.published_at && (!existing.first_public_at || m.published_at < existing.first_public_at)) {
      patch.first_public_at = m.published_at;
      patch.first_source_id = m.source_id;
    }
    if (conflicts.length !== existing.conflicts.length) patch.conflicts = conflicts;
    if (Object.keys(patch).length) {
      patch.last_changed_at = now.toISOString();
      await repo.updateEvent(existing.id, patch);
    }
    event = { ...existing, ...patch };
  }

  await repo.addEventSource({
    event_id: event!.id, observation_id: m.observation_id, source_id: m.source_id, url: m.url, is_primary: m.is_primary,
    snippet: m.snippet.slice(0, 600), published_at: m.published_at, first_seen_at: now.toISOString(),
  });

  for (const t of c.tiers) {
    const row = tierToRow(t, event!.id, m.url);
    const prev = before?.tiers.find((x) => x.tier_type === row.tier_type && x.name_raw.toLowerCase() === row.name_raw.toLowerCase());
    // A non-primary source cannot downgrade facts a primary source stated; it may only fill gaps.
    if (prev && !m.is_primary) {
      await repo.upsertTier({
        ...prev,
        price_inr_min: prev.price_inr_min ?? row.price_inr_min,
        price_inr_max: prev.price_inr_max ?? row.price_inr_max,
        sale_start_at: prev.sale_start_at ?? row.sale_start_at,
        sale_end_at: prev.sale_end_at ?? row.sale_end_at,
        quantity_note: prev.quantity_note ?? row.quantity_note,
        availability: prev.availability === "unknown" ? row.availability : prev.availability,
      });
    } else {
      await repo.upsertTier(row);
    }
  }

  const after = await recompute(repo, event!, artists, homeCity, explicit, now);
  return { before, after: { event: after, tiers: await repo.listTiers([after.id]) }, isNew };
}
