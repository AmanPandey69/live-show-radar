import type { ObservationInput } from "@/lib/domain/schemas";
import { extractJsonLd, isEvent, jsonLdImage, jsonLdToCandidate } from "../parse/jsonld";
import type { SourceAdapter } from "../types";
import { obs, rotate, timeLeft } from "./common";

export const ALLEVENTS_PAGES = [
  "https://allevents.in/bangalore/concerts",
  "https://allevents.in/mumbai/concerts",
  "https://allevents.in/delhi/concerts",
  "https://allevents.in/hyderabad/concerts",
  "https://allevents.in/chennai/concerts",
  "https://allevents.in/kolkata/concerts",
  "https://allevents.in/goa/concerts",
];

/** allevents.in aggregator: Event JSON-LD on city listing pages. Secondary (not primary) source. */
export const alleventsAdapter: SourceAdapter = {
  id: "allevents",
  name: "allevents.in (aggregator)",
  kind: "aggregator",
  is_primary: false,
  capabilities: ["listing"],
  rateLimit: { minIntervalMs: 4000 },
  lanes: ["fast", "daily", "manual", "replay"],
  disabledReason: () => null,
  async fetchNew(ctx) {
    const out: ObservationInput[] = [];
    // Bengaluru every run; two other cities per run in rotation (each ~every 20 min at a 5-min cadence).
    const others = await rotate(ctx.repo, "allevents:cursor", ALLEVENTS_PAGES.slice(1), ctx.lane === "fast" ? 2 : ALLEVENTS_PAGES.length);
    for (const url of [ALLEVENTS_PAGES[0], ...others]) {
      if (!timeLeft(ctx.deadline)) break;
      let page;
      try {
        page = await ctx.http.get(url, { conditional: true, minIntervalMs: this.rateLimit.minIntervalMs });
      } catch (e) {
        if ((e as Error).name === "BlockedError") throw e;
        ctx.log(`allevents: ${(e as Error).message}`); // one bad page (e.g. 404) must not fail the source
        continue;
      }
      if (page.notModified) continue;
      for (const ev of extractJsonLd(page.body).filter(isEvent)) {
        const name = String(ev.name ?? "");
        if (!ctx.matcher.anyMatch(name)) continue;
        const candidate = jsonLdToCandidate(ev, String(ev.url ?? url), ctx.now);
        if (!candidate) continue;
        const evUrl = typeof ev.url === "string" ? ev.url : url;
        out.push({ ...obs({ source_id: this.id, url: evUrl, text: JSON.stringify(ev), title: name, snippet: name, candidate, is_primary: false, now: ctx.now }), image_url: jsonLdImage(ev) });
      }
    }
    return out;
  },
};
