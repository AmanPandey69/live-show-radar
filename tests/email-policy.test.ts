import { describe, expect, it } from "vitest";
import { Gemini } from "@/lib/ai/gemini";
import { MemoryRepo } from "@/lib/db/memory";
import type { Notifier, OutgoingMessage } from "@/lib/notify/notifiers";
import { MockNotifier } from "@/lib/notify/notifiers";
import { Engine } from "@/lib/pipeline/engine";
import { seedArtists } from "@/lib/seed";

const NOW = new Date("2026-10-12T06:00:00Z"); // 11:30 IST, outside quiet hours

class FakeEmail implements Notifier {
  channel = "email" as const;
  sent: OutgoingMessage[] = [];
  available() { return true; }
  async send(m: OutgoingMessage) { this.sent.push(m); return { ok: true, external_id: "x" }; }
}

describe("email policy: one email per newly announced show, everything else in-app", () => {
  it("emails NEW_SHOW once; later updates go to the notification bell only", async () => {
    const repo = new MemoryRepo();
    await seedArtists(repo);
    const email = new FakeEmail();
    const gemini = new Gemini(repo, { model: "google/gemini-3.8-flash", dailyCalls: 0, dailyGrounded: 0, groundingEnabled: false });
    const engine = await new Engine(repo, gemini, { primary: [email], mock: new MockNotifier() }, { homeCity: "Bengaluru", appBaseUrl: "https://x.test", now: () => NOW }).refresh();
    const mk = (hash: string, text: string) => ({ source_id: "bing-news", url: `https://example-news.test/${hash}`, fetched_at: NOW.toISOString(), published_at: null, content_hash: hash, title: text.split(".")[0], text, snippet: text, candidate: null, is_primary: false });

    await engine.ingest(mk("a", "The Local Train announce Bengaluru show at Fandom on 21 November 2026."));
    expect(email.sent).toHaveLength(1);

    await engine.ingest(mk("b", "The Local Train Bengaluru show at Fandom on 21 November 2026: early bird tickets live now, limited quantity."));
    expect(email.sent).toHaveLength(1); // early-bird update → bell only
    const deliveries = repo.deliveries.map((d) => d.channel);
    expect(deliveries).toContain("inapp");
  });
});
