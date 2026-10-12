import { aiScout } from "@/lib/ai/tasks";
import type { Gemini } from "@/lib/ai/gemini";
import type { ObservationInput } from "@/lib/domain/schemas";
import { effectiveAffinity } from "@/lib/domain/rules";
import type { Artist, Settings } from "@/lib/domain/types";
import { utcToIstDate } from "@/lib/text/dates-ist";
import { quoteInText } from "@/lib/pipeline/truth";
import type { AdapterContext, SourceAdapter } from "../types";
import { obs, timeLeft } from "./common";

const ARTISTS_PER_CALL = 3;

/** Coverage scheduler: artists ordered by how overdue they are (must-see every 3h, others every 12h by default). */
export function dueArtists(artists: Artist[], settings: Settings, now: Date, priorityIds: string[] = []): Artist[] {
  const period = (a: Artist) => (effectiveAffinity(a) === "must_see" ? settings.coverage_hours.must_see : settings.coverage_hours.default) * 3_600_000;
  const overdue = (a: Artist) => (a.last_deep_checked_at ? (now.getTime() - Date.parse(a.last_deep_checked_at)) / period(a) : 99);
  const enabled = artists.filter((a) => a.enabled);
  const boosted = enabled.filter((a) => priorityIds.includes(a.id));
  const rest = enabled.filter((a) => !priorityIds.includes(a.id) && overdue(a) >= 0.9).sort((a, b) => overdue(b) - overdue(a));
  return [...boosted, ...rest];
}

async function resolveRedirect(url: string): Promise<string> {
  // Grounding citations may be vertexaisearch redirect links; resolve to the publisher URL without fetching the body.
  if (!/vertexaisearch\.cloud\.google\.com|google\.com\/url/.test(url)) return url;
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return r.headers.get("location") ?? url;
  } catch {
    return url;
  }
}

/**
 * Gemini + Google Search grounding scout (deep lane). Findings are LEADS: each becomes an observation whose
 * text is the cited quote; it goes through the same extraction + truth gate, and stays "unconfirmed" until a
 * primary source or a second independent source corroborates it.
 */
export function makeScoutAdapter(gemini: Gemini, settingsRef: () => Settings, callsPerRun: number): SourceAdapter & { lastWhispers: { artist_id: string; o: ObservationInput }[] } {
  const adapter = {
    id: "gemini-scout",
    name: "Gemini + Google Search (grounded scout)",
    kind: "search" as const,
    is_primary: false,
    capabilities: ["search", "whisper"] as SourceAdapter["capabilities"],
    rateLimit: { minIntervalMs: 0 },
    lanes: ["deep", "manual"] as SourceAdapter["lanes"],
    lastWhispers: [] as { artist_id: string; o: ObservationInput }[],
    disabledReason: (e: { GEMINI_GROUNDING_ENABLED: boolean; GEMINI_API_KEY?: string; OPENROUTER_API_KEY?: string; MOCK_MODE: boolean }) =>
      e.MOCK_MODE || (!e.GEMINI_API_KEY && !e.OPENROUTER_API_KEY) ? "no AI key (OPENROUTER_API_KEY / GEMINI_API_KEY) or MOCK_MODE" : !e.GEMINI_GROUNDING_ENABLED ? "grounding disabled (free tier has no Google Search grounding)" : null,
    async fetchNew(ctx: AdapterContext): Promise<ObservationInput[]> {
      adapter.lastWhispers = [];
      const out: ObservationInput[] = [];
      const queue = (await ctx.repo.getKv<string[]>("scout:priority")) ?? [];
      const due = dueArtists(ctx.artists, settingsRef(), ctx.now, queue);
      const today = utcToIstDate(ctx.now.toISOString());
      for (let call = 0; call < callsPerRun && due.length && timeLeft(ctx.deadline, 20_000); call++) {
        const batch = due.splice(0, ARTISTS_PER_CALL);
        const r = await aiScout(gemini, { artists: batch.map((a) => ({ name: a.name, international: a.is_international })), today });
        if (!r.ok) {
          ctx.log(`scout: ${r.reason} ${(r.detail ?? "").slice(0, 200)}`);
          if (r.reason === "no_grounding" || r.reason === "disabled") throw new Error(`no_grounding: ${r.detail ?? r.reason}`);
          break; // budget/cooldown: stop this run, coverage resumes next run
        }
        await ctx.repo.touchArtists(batch.map((a) => a.id), "last_deep_checked_at", ctx.now.toISOString());
        await ctx.repo.setKv("scout:priority", queue.filter((id) => !batch.some((b) => b.id === id)));
        const cited = new Set(r.citations.map((c) => c.url));
        const citedText = r.citations.map((c) => c.cited_text ?? "").join("\n");
        for (const f of r.data.findings) {
          if (f.kind === "none" || !f.source_url) continue;
          const artist = batch.find((a) => a.name.toLowerCase() === f.artist.toLowerCase()) ?? batch.find((a) => f.artist.toLowerCase().includes(a.name.toLowerCase()));
          if (!artist) continue;
          // Keep only URLs Google actually returned (when citations exist) or quotes the citations contain.
          if (cited.size && !cited.has(f.source_url) && !quoteInText(f.quote, citedText)) {
            ctx.log(`scout: dropped uncited finding ${f.source_url}`);
            continue;
          }
          const url = await resolveRedirect(f.source_url);
          const text = `${f.title}\n${f.quote}`;
          const o = obs({ source_id: "gemini-scout", url, text, title: f.title, snippet: f.quote, is_primary: false, now: ctx.now });
          if (f.kind === "signal") adapter.lastWhispers.push({ artist_id: artist.id, o });
          else out.push(o);
        }
      }
      return out;
    },
  };
  return adapter;
}
