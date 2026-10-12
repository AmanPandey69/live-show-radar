import { describe, expect, it } from "vitest";
import { classifyTier, findTierPhrases, parseTierPhrase } from "@/lib/text/earlybird";

const REF = new Date("2026-10-12T06:00:00Z"); // Mon 12 Oct 2026, 11:30 IST

describe("early-bird phrasings", () => {
  it("'Early Bird till 15th Nov' → early_bird, deadline 15 Nov 23:59, open (inferred)", () => {
    const s = parseTierPhrase("Early Bird till 15th Nov", REF);
    expect(s.tier_type).toBe("early_bird");
    expect(s.sale_end).toMatchObject({ date: "2026-11-15", time: "23:59" });
    expect(s.availability).toBe("open");
    expect(s.availability_basis).toBe("inferred");
  });

  it("'Phase 1 tickets' → phase_1, availability unknown (nothing stated)", () => {
    const s = parseTierPhrase("Phase 1 tickets", REF);
    expect(s.tier_type).toBe("phase_1");
    expect(s.availability).toBe("unknown");
    expect(s.sale_end).toBeNull();
  });

  it("'Tier 1' → phase_1", () => expect(classifyTier("Tier 1")).toBe("phase_1"));

  it("'limited early access' → early_bird + limited", () => {
    const s = parseTierPhrase("limited early access", REF);
    expect(s.tier_type).toBe("early_bird");
    expect(s.quantity_note).toMatch(/^limited/);
    expect(s.sale_end).toBeNull(); // limited ≠ a deadline; never invent one
  });

  it("'presale for cardholders' → presale_card", () => {
    expect(classifyTier("presale for cardholders")).toBe("presale_card");
    const s = parseTierPhrase("HDFC Bank presale opens 20 Oct, 12 PM", REF);
    expect(s.tier_type).toBe("presale_card");
    expect(s.presale_partner).toBe("HDFC");
    expect(s.sale_start).toMatchObject({ date: "2026-10-20", time: "12:00" });
    expect(s.availability).toBe("upcoming");
  });

  it("'opens Saturday 10am' → upcoming with start Sat 17 Oct 10:00", () => {
    const s = parseTierPhrase("Early bird opens Saturday 10am", REF);
    expect(s.tier_type).toBe("early_bird");
    expect(s.availability).toBe("upcoming");
    expect(s.sale_start).toMatchObject({ date: "2026-10-17", time: "10:00" });
  });

  it("membership presale", () => {
    expect(classifyTier("District Pass members presale")).toBe("presale_membership");
    expect(classifyTier("Artist presale for fan club")).toBe("presale_membership");
  });

  it("past deadline → closed", () => {
    expect(parseTierPhrase("Early bird valid till 1st Oct", REF).availability).toBe("closed");
  });

  it("sold out / first N", () => {
    expect(parseTierPhrase("Early Bird - SOLD OUT", REF).availability).toBe("sold_out");
    expect(parseTierPhrase("Early bird: first 100 tickets only", REF).quantity_note).toBe("first 100 tickets");
  });

  it("'Early Bird | Diamond' is early bird, not VIP", () => {
    expect(classifyTier("Early Bird | Diamond")).toBe("early_bird");
    expect(classifyTier("Diamond")).toBe("vip");
    expect(classifyTier("Phase 2 | GA")).toBe("general");
  });

  it("finds tier lines inside a caption", () => {
    const caption = `BENGALURU, we're coming! 🎸\nSat 14 Nov at Phoenix Arena.\nEarly bird tickets live now — limited quantity.\nGeneral sale opens 20th Oct 12pm.`;
    const sigs = findTierPhrases(caption, REF);
    expect(sigs.find((s) => s.tier_type === "early_bird")).toMatchObject({ availability: "open", availability_basis: "stated", quantity_note: "limited quantity" });
    expect(sigs.find((s) => s.tier_type === "general")).toMatchObject({ availability: "upcoming" });
  });
});
