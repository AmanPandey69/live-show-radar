import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicExtract } from "@/lib/pipeline/heuristic";
import { enforceTruth } from "@/lib/pipeline/truth";
import { extractJsonLd, isEvent, jsonLdToCandidate } from "@/lib/sources/parse/jsonld";
import { parseRss, parseSitemap } from "@/lib/sources/parse/rss";
import { ArtistMatcher } from "@/lib/text/match";

const NOW = new Date("2026-10-12T06:00:00Z");
const fx = (p: string) => readFileSync(`fixtures/${p}`, "utf8");

describe("District JSON-LD (real snapshot)", () => {
  const html = fx("pages/district-papon-bengaluru.html");
  const ev = extractJsonLd(html).find(isEvent)!;
  const c = jsonLdToCandidate(ev, "https://www.district.in/events/papon-live-in-concert-bengaluru-2026-buy-tickets", NOW)!;

  it("parses the show in IST", () => {
    expect(c.title).toBe("Papon Live In Concert | Bengaluru");
    expect(c.city).toBe("Bengaluru");
    expect(c.venue).toBe("District Arena @ Terraform");
    expect(c.date).toBe("2026-11-14");
    expect(c.show_time).toBe("19:00"); // 13:30Z = 7pm IST
  });
  it("classifies tiers and keeps prices", () => {
    const eb = c.tiers.filter((t) => t.tier_type === "early_bird");
    expect(eb.length).toBeGreaterThan(0);
    expect(eb[0]).toMatchObject({ availability: "open", price_inr_min: 4999, field_confidence: "confirmed" });
    expect(c.tiers.some((t) => t.tier_type === "phase_1")).toBe(true);
  });
  it("does NOT treat availabilityEnds = show start as an early-bird deadline", () => {
    expect(c.tiers.every((t) => t.sale_end_date === null)).toBe(true);
  });
  it("survives the truthfulness gate unchanged", () => {
    const text = JSON.stringify(ev);
    const { candidate, report } = enforceTruth(c, text);
    expect(report.rejected).toBe(false);
    expect(report.dropped).toEqual([]);
    expect(candidate.date).toBe("2026-11-14");
  });
});

describe("allevents JSON-LD (real snapshot)", () => {
  it("yields India events with venues and dates", () => {
    const events = extractJsonLd(fx("pages/allevents-bangalore-concerts.html")).filter(isEvent);
    const cands = events.map((e) => jsonLdToCandidate(e, "https://allevents.in/bangalore/concerts", NOW)).filter(Boolean);
    const raghu = cands.find((c) => /raghu dixit/i.test(c!.title))!;
    expect(raghu).toMatchObject({ city: "Bengaluru", date: "2026-10-24" });
  });
});

describe("sitemaps & RSS", () => {
  it("parses the District sitemap snapshot", () => {
    const { urls } = parseSitemap(fx("rss/district-event-sitemap.xml"));
    expect(urls.length).toBe(40);
    expect(urls.some((u) => u.loc.includes("papon"))).toBe(true);
  });
  it("parses Bing RSS and unwraps click-tracker links", () => {
    const items = parseRss(fx("rss/bing-news-SYNTHETIC.xml"));
    expect(items).toHaveLength(3);
    expect(items[0].link).toBe("https://example-news.test/music/local-train-bengaluru-2026");
    expect(items[0].published_at).toBe("2026-10-12T04:10:00.000Z");
  });
});

describe("heuristic fallback extraction", () => {
  const m = new ArtistMatcher({ artists: [{ id: "ltr", name: "The Local Train", enabled: true }], aliases: [], blocks: [] });
  const item = parseRss(fx("rss/bing-news-SYNTHETIC.xml"))[0];
  const text = `${item.title}\n${item.description}`;

  it("extracts a conservative candidate with evidence", () => {
    const c = heuristicExtract(text, m.match(text), NOW)!;
    expect(c.city).toBe("Bengaluru");
    expect(c.date).toBe("2026-11-21");
    expect(c.venue).toMatch(/^Phoenix Marketcity/);
    const eb = c.tiers.find((t) => t.tier_type === "early_bird")!;
    expect(eb).toMatchObject({ availability: "upcoming", sale_start_date: "2026-10-16", sale_start_time: "12:00" });
    const { report } = enforceTruth(c, text);
    expect(report.rejected).toBe(false);
  });
  it("rejects the tribute item", () => {
    const t = parseRss(fx("rss/bing-news-SYNTHETIC.xml"))[1];
    const txt = `${t.title}\n${t.description}`;
    expect(heuristicExtract(txt, m.match(txt), NOW)).toBeNull();
  });
});
