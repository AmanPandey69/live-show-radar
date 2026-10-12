import type { SourceRow } from "@/lib/domain/types";

/** All sources known to the system (incl. disabled/blocked ones, so /health shows the full picture). */
export const STATIC_SOURCES: SourceRow[] = [
  { id: "district", name: "District (Zomato): sitemap + JSON-LD", kind: "ticketing", is_primary: true, enabled: true, config: { lane: "fast" } },
  { id: "skillbox", name: "SkillBox: sitemap leads", kind: "ticketing", is_primary: true, enabled: true, config: { lane: "fast" } },
  { id: "allevents", name: "allevents.in city concert pages", kind: "aggregator", is_primary: false, enabled: true, config: { lane: "fast" } },
  { id: "bing-news", name: "Bing News RSS", kind: "news", is_primary: false, enabled: true, config: { lane: "fast" } },
  { id: "google-news", name: "Google News RSS (off: robots.txt)", kind: "news", is_primary: false, enabled: false, config: { lane: "fast" } },
  { id: "gemini-scout", name: "Gemini Flash + Google Search grounding", kind: "search", is_primary: false, enabled: true, config: { lane: "deep" } },
  { id: "share", name: "Share-to-Radar (link / caption / poster upload)", kind: "share", is_primary: false, enabled: true, config: { lane: "push" } },
  { id: "bookmyshow", name: "BookMyShow (blocked by Cloudflare: search-discovered only)", kind: "ticketing", is_primary: true, enabled: false, config: { status: "blocked" } },
  { id: "ticketgenie", name: "Ticketgenie (API 403: search-discovered only)", kind: "ticketing", is_primary: true, enabled: false, config: { status: "blocked" } },
  { id: "bandsintown", name: "Bandsintown (needs written consent + app_id)", kind: "api", is_primary: false, enabled: false, config: { env: "BANDSINTOWN_APP_ID" } },
  { id: "ticketmaster", name: "Ticketmaster Discovery (optional key)", kind: "api", is_primary: false, enabled: false, config: { env: "TICKETMASTER_API_KEY" } },
  { id: "demo", name: "Demo / simulation", kind: "fixture", is_primary: true, enabled: true, config: {} },
];
