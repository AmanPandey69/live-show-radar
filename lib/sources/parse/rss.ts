import { XMLParser } from "fast-xml-parser";
import { htmlToText } from "@/lib/text/normalize";

export interface FeedItem { title: string; link: string; description: string; published_at: string | null; source: string | null }

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, textNodeName: "#text" });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
};

/** Bing/Google wrap publisher links in click-trackers; keep the real publisher URL. */
export function unwrapLink(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com") && u.searchParams.get("url")) return u.searchParams.get("url")!;
    return link;
  } catch {
    return link;
  }
}

export function parseRss(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map((it: Record<string, unknown>) => {
    const linkRaw = typeof it.link === "object" && it.link && "@_href" in (it.link as object) ? String((it.link as Record<string, unknown>)["@_href"]) : text(it.link);
    const pub = text(it.pubDate) || text(it.published) || text(it.updated);
    const d = pub ? new Date(pub) : null;
    return {
      title: htmlToText(text(it.title)),
      link: unwrapLink(linkRaw.trim()),
      description: htmlToText(text(it.description) || text(it.summary) || text(it.content)),
      published_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      source: text(it.Source) || text(it.source) || null,
    };
  });
}

export interface SitemapUrl { loc: string; lastmod: string | null }

export function parseSitemap(xml: string): { urls: SitemapUrl[]; sitemaps: SitemapUrl[] } {
  const doc = parser.parse(xml);
  const toArr = (x: unknown) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const urls = toArr(doc?.urlset?.url).map((u: Record<string, unknown>) => ({ loc: text(u.loc).trim(), lastmod: text(u.lastmod).trim() || null }));
  const sitemaps = toArr(doc?.sitemapindex?.sitemap).map((u: Record<string, unknown>) => ({ loc: text(u.loc).trim(), lastmod: text(u.lastmod).trim() || null }));
  return { urls, sitemaps };
}
