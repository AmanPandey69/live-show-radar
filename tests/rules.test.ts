import { describe, expect, it } from "vitest";
import { canTransition, corroborate, deriveStatus, fingerprint, isSameShow, priorityFor, urgencyScore } from "@/lib/domain/rules";
import { canonicalCity, citiesIn } from "@/lib/text/cities";

const ev = (o: Partial<Parameters<typeof isSameShow>[1]> = {}) => ({
  headliner_ids: ["a1"], support_ids: [], city: "Bengaluru", start_date_local: "2026-11-14",
  venue_name_raw: "Phoenix Marketcity", festival_name: null, ...o,
});

describe("cities", () => {
  it("canonicalises Bangalore/Bengaluru and neighbourhoods", () => {
    expect(canonicalCity("Bangalore")).toBe("Bengaluru");
    expect(canonicalCity("Yelahanka, Bengaluru, Karnataka 562157")).toBe("Bengaluru");
    expect(canonicalCity("Gurgaon")).toBe("Delhi NCR");
    expect(canonicalCity("Paris")).toBeNull();
    expect(citiesIn("Mumbai on 12th, then Bangalore on 14th")).toEqual(["Mumbai", "Bengaluru"]);
  });
});

describe("dedupe", () => {
  it("fingerprint is order-independent and city-canonical", () => {
    expect(fingerprint(["b", "a"], "Bangalore", "2026-11-14")).toBe(fingerprint(["a", "b"], "Bengaluru", "2026-11-14"));
  });
  it("merges same artist/city/±1 day/fuzzy venue", () => {
    expect(isSameShow({ ...ev(), venue_name_raw: "Phoenix Marketcity Whitefield" }, ev())).toBe(true);
    expect(isSameShow({ ...ev(), start_date_local: "2026-11-15" }, ev())).toBe(true); // timezone/late-night slip
  });
  it("does not merge different cities, far dates, or different venues a day apart", () => {
    expect(isSameShow({ ...ev(), city: "Mumbai" }, ev())).toBe(false);
    expect(isSameShow({ ...ev(), start_date_local: "2026-11-20" }, ev())).toBe(false);
    expect(isSameShow({ ...ev(), start_date_local: "2026-11-15", venue_name_raw: "Bangalore Palace Grounds" }, ev())).toBe(false);
  });
  it("keeps two-night runs separate when the exact date already exists", () => {
    expect(isSameShow({ ...ev(), start_date_local: "2026-11-15" }, ev(), ["2026-11-15"])).toBe(false);
  });
  it("merges festival mentions without shared artists", () => {
    expect(isSameShow({ ...ev(), headliner_ids: ["zz"], festival_name: "NH7 Weekender" }, ev({ festival_name: "Bacardi NH7 Weekender" }))).toBe(true);
  });
});

describe("corroboration", () => {
  it("one primary source → confirmed", () => {
    expect(corroborate([{ url: "https://www.district.in/events/x", is_primary: true, source_id: "district" }])).toBe("confirmed");
  });
  it("two independent hosts → confirmed; same host twice → unconfirmed", () => {
    expect(corroborate([
      { url: "https://a.com/1", is_primary: false, source_id: "news" },
      { url: "https://b.com/2", is_primary: false, source_id: "news" },
    ])).toBe("confirmed");
    expect(corroborate([
      { url: "https://a.com/1", is_primary: false, source_id: "news" },
      { url: "https://www.a.com/2", is_primary: false, source_id: "news" },
    ])).toBe("unconfirmed");
  });
  it("only rumours → rumoured", () => {
    expect(corroborate([{ url: "https://a.com/1", is_primary: false, source_id: "news", rumour: true }])).toBe("rumoured");
  });
});

describe("state machine", () => {
  it("derives status from tiers", () => {
    expect(deriveStatus(null, [{ tier_type: "early_bird", availability: "open" }], null, "confirmed")).toBe("early_bird");
    expect(deriveStatus(null, [{ tier_type: "presale_card", availability: "open" }], null, "confirmed")).toBe("presale");
    expect(deriveStatus(null, [{ tier_type: "general", availability: "open" }], null, "confirmed")).toBe("general_sale");
    expect(deriveStatus(null, [{ tier_type: "general", availability: "sold_out" }], null, "confirmed")).toBe("sold_out");
    expect(deriveStatus(null, [], null, "rumoured")).toBe("rumoured");
    expect(deriveStatus(null, [], null, "confirmed")).toBe("announced");
  });
  it("explicit cancel wins; cancelled is terminal", () => {
    expect(deriveStatus("early_bird", [{ tier_type: "early_bird", availability: "open" }], "cancelled", "confirmed")).toBe("cancelled");
    expect(deriveStatus("cancelled", [], null, "confirmed")).toBe("cancelled");
    expect(canTransition("cancelled", "announced")).toBe(false);
    expect(canTransition("sold_out", "general_sale")).toBe(true); // extra release
    expect(canTransition("sold_out", "early_bird")).toBe(false);
  });
});

describe("priority & urgency", () => {
  const eb = [{ tier_type: "early_bird" as const, availability: "open" as const }];
  it("P0 = Bengaluru AND (early-bird OR must-see)", () => {
    expect(priorityFor({ city: "Bangalore", home_city: "Bengaluru", affinity: "casual", tiers: eb })).toBe("P0");
    expect(priorityFor({ city: "Bengaluru", home_city: "Bengaluru", affinity: "must_see", tiers: [] })).toBe("P0");
  });
  it("P1 = other-city early-bird, or any Bengaluru show", () => {
    expect(priorityFor({ city: "Mumbai", home_city: "Bengaluru", affinity: "casual", tiers: eb })).toBe("P1");
    expect(priorityFor({ city: "Bengaluru", home_city: "Bengaluru", affinity: "like", tiers: [] })).toBe("P1");
  });
  it("P2 otherwise", () => {
    expect(priorityFor({ city: "Mumbai", home_city: "Bengaluru", affinity: "must_see", tiers: [] })).toBe("P2");
  });
  it("urgency favours small rooms, must-see, fresh early-bird", () => {
    const now = new Date("2026-10-12T06:00:00Z");
    const hot = urgencyScore({ city: "Bengaluru", home_city: "Bengaluru", affinity: "must_see", tiers: eb, capacity_approx: 500, announced_at: "2026-10-12T05:00:00Z", now });
    const cold = urgencyScore({ city: "Mumbai", home_city: "Bengaluru", affinity: "casual", tiers: [], capacity_approx: 20000, announced_at: "2026-10-01T05:00:00Z", now });
    expect(hot).toBe(100);
    expect(cold).toBeLessThan(20);
  });
});
