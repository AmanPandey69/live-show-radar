import { describe, expect, it } from "vitest";
import { ArtistMatcher } from "@/lib/text/match";
import { prefilter } from "@/lib/text/prefilter";

const artists = [
  { id: "a1", name: "The Local Train", enabled: true },
  { id: "a2", name: "Coldplay", enabled: true },
  { id: "a3", name: "Phoenix", enabled: true },
  { id: "a4", name: "Prateek Kuhad", enabled: true },
  { id: "a5", name: "Seedhe Maut", enabled: true },
  { id: "a6", name: "Nothing But Thieves", enabled: true },
  { id: "a7", name: "Low", enabled: true },
  { id: "a8", name: "Sigur Rós", enabled: true },
  { id: "a9", name: "Divine", enabled: true },
];
const aliases = [
  { artist_id: "a5", alias: "सीधे मौत" },
  { artist_id: "a4", alias: "Prateek Kuhad Live" },
];
const m = new ArtistMatcher({ artists, aliases, blocks: [{ artist_id: "a9", pattern: "divine comedy", reason: "namesake" }] });

describe("alias matching", () => {
  it("matches with and without 'The', hyphens and case", () => {
    expect(m.match("Local Train live in Bengaluru").map((x) => x.artist_id)).toEqual(["a1"]);
    expect(m.anyMatch("the-local-train-bengaluru-2026-buy-tickets")).toBe(true); // lenient slug prefilter
    expect(m.match("Meet the Dabbawalas and take a Mumbai Local Train Ride")).toHaveLength(0); // no music context → not the band
    expect(m.match("SEEDHE MAUT India tour").map((x) => x.artist_id)).toEqual(["a5"]);
  });
  it("matches diacritics-insensitive and transliterated aliases", () => {
    expect(m.match("Sigur Ros returns to Mumbai").map((x) => x.artist_id)).toEqual(["a8"]);
    expect(m.match("सीधे मौत लाइव").map((x) => x.artist_id)).toEqual(["a5"]);
  });
  it("respects word boundaries", () => {
    expect(m.match("Coldplayers fan meetup")).toHaveLength(0);
  });
});

describe("namesake & tribute guard", () => {
  it("blocks tribute acts", () => {
    const r = m.match("A Tribute to Coldplay — live at Hard Rock Cafe Bengaluru");
    expect(r[0].blocked?.reason).toBe("tribute");
    expect(m.match("Candlelight: Best of Coldplay, Bengaluru")[0].blocked?.reason).toBe("tribute");
    expect(m.match("The Coldplay Experience feat. local band")[0].blocked?.reason).toBe("tribute");
  });
  it("blocks configured namesakes", () => {
    expect(m.match("The Divine Comedy live in Mumbai")[0].blocked?.reason).toBe("namesake");
    expect(m.match("DIVINE live in Mumbai")[0].blocked).toBeNull();
  });
  it("common-word names need capitalisation and music context", () => {
    expect(m.match("there was low turnout at the meeting")).toHaveLength(0);
    expect(m.match("Phoenix Marketcity mall opens new wing")).toHaveLength(0); // no music context
    const r = m.match("Low announce India tour, Bengaluru show on 14 Nov");
    expect(r[0]).toMatchObject({ artist_id: "a7", needs_resolution: true });
  });
  it("venue named like an artist is flagged for resolution, not trusted", () => {
    const r = m.match("Prateek Kuhad live at Phoenix Marketcity, Bengaluru");
    const phoenix = r.find((x) => x.artist_id === "a3");
    expect(r.find((x) => x.artist_id === "a4")?.blocked).toBeNull();
    expect(phoenix?.needs_resolution).toBe(true);
  });
  it("detects support slots", () => {
    const r = m.match("Coldplay in Mumbai, supported by The Local Train");
    expect(r.find((x) => x.artist_id === "a1")?.role).toBe("support");
    expect(r.find((x) => x.artist_id === "a2")?.role).toBe("headliner");
  });
  it("prefers the longer alias ('Nothing But Thieves' is not 'Nothing')", () => {
    expect(m.match("Nothing But Thieves to play Bengaluru").map((x) => x.artist_id)).toEqual(["a6"]);
  });
});

describe("prefilter", () => {
  const REF = new Date("2026-10-12T06:00:00Z");
  it("passes artist + India city + date", () => {
    expect(prefilter("Prateek Kuhad live in Bangalore on 14 Nov", m, REF)).toMatchObject({ pass: true, cities: ["Bengaluru"] });
  });
  it("rejects non-India mentions but flags whisper wording", () => {
    expect(prefilter("Prateek Kuhad announces Singapore and Dubai dates", m, REF)).toMatchObject({ pass: false, whisper: true });
    expect(prefilter("Coldplay new album review", m, REF)).toMatchObject({ pass: false, whisper: false });
  });
  it("rejects tribute-only text", () => {
    expect(prefilter("Coldplay tribute night at Bengaluru pub, 20 Oct", m, REF)).toMatchObject({ pass: false, reason: "blocked:tribute" });
  });
});
