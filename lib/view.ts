import { Gemini } from "@/lib/ai/gemini";
import { ticketStatusLine } from "@/lib/alerts/render";
import { getRepo } from "@/lib/db";
import { effectiveAffinity } from "@/lib/domain/rules";
import type { Alert, Artist, EventRow, EventSource, TicketTier } from "@/lib/domain/types";
import { isHomeCity } from "@/lib/text/cities";
import { utcToIstDate } from "@/lib/text/dates-ist";

export interface EventView {
  event: EventRow;
  tiers: TicketTier[];
  sources: EventSource[];
  artists: string[];
  statusLine: string;
  isHome: boolean;
  isNew: boolean;
  countdown: { label: string; at: string } | null;
}

export async function loadRadar(filters: { city?: string; artist?: string } = {}) {
  const repo = getRepo();
  const today = utcToIstDate(new Date().toISOString());
  const [events, artists] = await Promise.all([repo.listEvents({ fromDate: today }), repo.listArtists()]);
  const ids = events.map((e) => e.id);
  const [tiers, sources, settings] = await Promise.all([repo.listTiers(ids), repo.listEventSources(ids), repo.getSettings()]);
  const name = (id: string) => artists.find((a) => a.id === id)?.name ?? "?";
  const now = Date.now();
  let views: EventView[] = events.map((e) => {
    const t = tiers.filter((x) => x.event_id === e.id);
    const early = t.filter((x) => ["early_bird", "phase_1", "presale_card", "presale_membership"].includes(x.tier_type));
    const upcoming = early.find((x) => x.availability === "upcoming" && x.sale_start_at && Date.parse(x.sale_start_at) > now);
    const closing = early.find((x) => x.availability === "open" && x.sale_end_at && Date.parse(x.sale_end_at) > now);
    return {
      event: e,
      tiers: t,
      sources: sources.filter((s) => s.event_id === e.id),
      artists: [...e.headliner_ids, ...e.support_ids].map(name),
      statusLine: ticketStatusLine(t),
      isHome: isHomeCity(e.city, settings.home_city),
      isNew: now - Date.parse(e.first_seen_at) < 24 * 3_600_000,
      countdown: upcoming ? { label: "Early-bird opens in", at: upcoming.sale_start_at! } : closing ? { label: "Early-bird closes in", at: closing.sale_end_at! } : null,
    };
  });
  if (filters.city) views = views.filter((v) => v.event.city === filters.city);
  if (filters.artist) views = views.filter((v) => v.artists.includes(filters.artist!));
  const cities = [...new Set(events.map((e) => e.city))].sort();
  const artistNames = [...new Set(events.flatMap((e) => [...e.headliner_ids, ...e.support_ids].map(name)))].sort();
  return { views, cities, artistNames, artists, settings };
}

export function latencyStats(alerts: Alert[]) {
  const mins = alerts
    // Only alerts whose source states a publish time: latency from our own first sighting would read as a fake "0 min".
    .filter((a) => a.sent_at && a.first_public_at && !a.is_demo && a.type !== "REMINDER" && a.type !== "DIGEST")
    .map((a) => (Date.parse(a.sent_at!) - Date.parse(a.first_public_at!)) / 60000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const pct = (p: number) => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : null);
  return { n: mins.length, median: pct(0.5), p90: pct(0.9) };
}

export function coverage(artists: Artist[], settings: { coverage_hours: { must_see: number; default: number } }, now = Date.now()) {
  return artists.filter((a) => a.enabled).map((a) => {
    const period = (effectiveAffinity(a) === "must_see" ? settings.coverage_hours.must_see : settings.coverage_hours.default) * 3_600_000;
    const last = a.last_deep_checked_at ? Date.parse(a.last_deep_checked_at) : null;
    return { artist: a, period, last, overdue: last === null || now - last > period };
  });
}

export async function geminiBudget() {
  const repo = getRepo();
  return Gemini.fromEnv(repo).budgetStatus();
}

export const fmtMins = (m: number | null) => (m == null ? "n/a" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
