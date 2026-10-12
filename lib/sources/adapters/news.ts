import type { ObservationInput } from "@/lib/domain/schemas";
import { effectiveAffinity } from "@/lib/domain/rules";
import { parseRss } from "../parse/rss";
import type { AdapterContext, SourceAdapter } from "../types";
import { obs, rotate, timeLeft } from "./common";

const CITY_QUERIES = [
  '"Bengaluru" concert tickets',
  '"Bangalore" gig announced',
  "India tour 2026 concert announced",
  "early bird tickets concert India",
];
const QUERIES_PER_RUN = 6;

async function newsQueries(ctx: AdapterContext, cursorKey: string): Promise<string[]> {
  // Must-see artists appear twice in the rotation, so they're queried twice as often.
  const ordered = ctx.artists
    .filter((a) => a.enabled)
    .flatMap((a) => (effectiveAffinity(a) === "must_see" ? [a, a] : [a]))
    .map((a) => `"${a.name}" India concert`);
  const city = await rotate(ctx.repo, `${cursorKey}:city`, CITY_QUERIES, 1);
  const artists = await rotate(ctx.repo, `${cursorKey}:artists`, ordered, QUERIES_PER_RUN - 1);
  return [...city, ...artists];
}

function makeNewsAdapter(p: { id: string; name: string; url: (q: string) => string; enabled: (e: { GOOGLE_NEWS_RSS_ENABLED: boolean }) => string | null }): SourceAdapter {
  return {
    id: p.id,
    name: p.name,
    kind: "news",
    is_primary: false,
    capabilities: ["news", "whisper"],
    rateLimit: { minIntervalMs: 3000 },
    lanes: ["fast", "manual", "replay"],
    disabledReason: (env) => p.enabled(env),
    async fetchNew(ctx) {
      const out: ObservationInput[] = [];
      const cutoff = ctx.now.getTime() - 14 * 86_400_000; // ignore stale news
      for (const q of await newsQueries(ctx, p.id)) {
        if (!timeLeft(ctx.deadline)) break;
        const res = await ctx.http.get(p.url(q), { accept: "application/rss+xml,application/xml", minIntervalMs: this.rateLimit.minIntervalMs });
        for (const item of parseRss(res.body)) {
          if (item.published_at && Date.parse(item.published_at) < cutoff) continue;
          const text = `${item.title}\n${item.description}`;
          if (!ctx.matcher.anyMatch(text)) continue;
          out.push(obs({ source_id: p.id, url: item.link, text, title: item.title, snippet: item.description || item.title, published_at: item.published_at, is_primary: false, now: ctx.now }));
        }
      }
      return out;
    },
  };
}

export const bingNewsAdapter = makeNewsAdapter({
  id: "bing-news",
  name: "Bing News RSS",
  url: (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-IN`,
  enabled: () => null,
});

export const googleNewsAdapter = makeNewsAdapter({
  id: "google-news",
  name: "Google News RSS",
  url: (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`,
  enabled: (e) => (e.GOOGLE_NEWS_RSS_ENABLED ? null : "off: news.google.com robots.txt disallows /rss (set GOOGLE_NEWS_RSS_ENABLED=true to override)"),
});
