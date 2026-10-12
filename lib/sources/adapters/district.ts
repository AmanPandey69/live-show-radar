import type { ObservationInput } from "@/lib/domain/schemas";
import { slugToText } from "@/lib/text/normalize";
import { extractJsonLd, isEvent, jsonLdToCandidate } from "../parse/jsonld";
import { parseSitemap } from "../parse/rss";
import type { SourceAdapter } from "../types";
import { obs, timeLeft } from "./common";

export const DISTRICT_INDEX = "https://cdn.district.in/sitemap/sitemap-events.xml";
const MAX_PAGES_PER_RUN = 20;

/**
 * District (Zomato): sitemap → artist-slug prefilter → event page JSON-LD.
 * Only URLs whose slug matches an artist alias are fetched; `lastmod` changes trigger a re-fetch.
 */
export const districtAdapter: SourceAdapter = {
  id: "district",
  name: "District (Zomato)",
  kind: "ticketing",
  is_primary: true,
  capabilities: ["listing", "event_page"],
  rateLimit: { minIntervalMs: 3000 },
  lanes: ["fast", "daily", "manual", "replay"],
  disabledReason: () => null,
  async fetchNew(ctx) {
    const out: ObservationInput[] = [];
    const index = await ctx.http.get(DISTRICT_INDEX, { conditional: true, accept: "application/xml" });
    const detailMaps = index.notModified
      ? ((await ctx.repo.getKv<string[]>("district:maps")) ?? [])
      : parseSitemap(index.body).sitemaps.map((s) => s.loc).filter((u) => /event-detail-pages/.test(u));
    if (!index.notModified) await ctx.repo.setKv("district:maps", detailMaps);

    const seen = (await ctx.repo.getKv<Record<string, string>>("district:matched")) ?? {};
    const queue: { loc: string; lastmod: string | null }[] = (await ctx.repo.getKv<{ loc: string; lastmod: string | null }[]>("district:queue")) ?? [];
    for (const mapUrl of detailMaps) {
      const res = await ctx.http.get(mapUrl, { conditional: true, accept: "application/xml" });
      if (res.notModified) continue;
      for (const u of parseSitemap(res.body).urls) {
        const key = u.lastmod ?? "";
        if (seen[u.loc] === key) continue;
        if (!ctx.matcher.anyMatch(slugToText(u.loc))) continue;
        if (!queue.some((q) => q.loc === u.loc)) queue.push(u);
      }
    }

    let fetched = 0;
    while (queue.length && fetched < MAX_PAGES_PER_RUN && timeLeft(ctx.deadline)) {
      const u = queue.shift()!;
      fetched++;
      try {
        const page = await ctx.http.get(u.loc, { minIntervalMs: this.rateLimit.minIntervalMs });
        const blocks = extractJsonLd(page.body);
        const events = blocks.filter(isEvent);
        const title = /<title>([^<]*)<\/title>/i.exec(page.body)?.[1]?.trim() ?? null;
        const text = [title, ...events.map((e) => JSON.stringify(e))].filter(Boolean).join("\n");
        for (const ev of events) {
          const candidate = jsonLdToCandidate(ev, u.loc, ctx.now);
          if (!candidate) continue;
          out.push(obs({ source_id: this.id, url: u.loc, text, title: candidate.title, snippet: candidate.title, candidate, is_primary: true, now: ctx.now }));
        }
        seen[u.loc] = u.lastmod ?? "";
      } catch (e) {
        ctx.log(`district: ${u.loc}: ${(e as Error).message}`);
        if ((e as Error).name === "BlockedError" || (e as Error).message.startsWith("blocked")) throw e;
      }
    }
    await ctx.repo.setKv("district:matched", seen);
    await ctx.repo.setKv("district:queue", queue);
    return out;
  },
};
