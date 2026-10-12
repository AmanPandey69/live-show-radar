import type { ObservationInput } from "@/lib/domain/schemas";
import { slugToText } from "@/lib/text/normalize";
import { parseSitemap } from "../parse/rss";
import type { SourceAdapter } from "../types";
import { obs } from "./common";

export const SKILLBOX_SITEMAP = "https://www.skillboxes.com/media/sitemap/sitemap-event.xml";

/**
 * SkillBox: event pages are a client-rendered SPA (no data in HTML), so we only use the sitemap:
 * a new/changed URL whose slug names a followed artist becomes a "lead" observation (no candidate).
 * The pipeline queues that artist for an immediate grounded scout lookup.
 */
export const skillboxAdapter: SourceAdapter = {
  id: "skillbox",
  name: "SkillBox (sitemap)",
  kind: "ticketing",
  is_primary: true,
  capabilities: ["listing"],
  rateLimit: { minIntervalMs: 5000 },
  lanes: ["fast", "daily", "manual", "replay"],
  disabledReason: () => null,
  async fetchNew(ctx) {
    const res = await ctx.http.get(SKILLBOX_SITEMAP, { conditional: true, accept: "application/xml" });
    if (res.notModified) return [];
    const seen = (await ctx.repo.getKv<Record<string, string>>("skillbox:matched")) ?? {};
    const recent = ctx.now.getTime() - 21 * 86_400_000;
    const out: ObservationInput[] = [];
    for (const u of parseSitemap(res.body).urls) {
      if (u.lastmod && Date.parse(u.lastmod) < recent) continue;
      if (seen[u.loc] === (u.lastmod ?? "")) continue;
      const text = slugToText(u.loc).replace(/^events /, "").replace(/ sb[a-z]{6}$/, "");
      if (!ctx.matcher.anyMatch(text)) continue;
      seen[u.loc] = u.lastmod ?? "";
      out.push(obs({ source_id: this.id, url: u.loc, text, title: text, snippet: `SkillBox listed: ${text}`, published_at: u.lastmod ? new Date(u.lastmod).toISOString() : null, is_primary: true, now: ctx.now, hashExtra: u.lastmod ?? "" }));
    }
    await ctx.repo.setKv("skillbox:matched", seen);
    return out;
  },
};
