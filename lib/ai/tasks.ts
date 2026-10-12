import { z } from "zod";
import {
  CandidateZ, ExtractionZ, ResolutionZ, ScoutZ, VerificationZ, WhisperZ, WhyZ,
  type Candidate, type Extraction, type Resolution, type Scout, type Verification, type WhisperOut,
} from "@/lib/domain/schemas";
import type { CallPriority, CallResult, Gemini } from "./gemini";

/**
 * Every Gemini Flash task in the app (and nothing else):
 * scout · extract · vision · resolve · verify · whisper · why.
 */

const TRUTH_RULES = `
TRUTHFULNESS RULES (mandatory):
- Use ONLY facts written in the provided source. Never use outside knowledge, never guess.
- Every *_evidence / evidence field must be a VERBATIM quote copied from the source (5–40 words).
- If a fact is not stated, set it to null (or "unknown" for availability). Do NOT invent prices, times, deadlines or availability.
- "Early bird till 15 Nov" gives a deadline; "limited" is a quantity note, NOT a deadline.
- Dates/times are Indian Standard Time wall clock: date "YYYY-MM-DD", time "HH:mm" (24h). Distinguish doors time vs show time.
- field_confidence: "confirmed" when the quote states it; "inferred" when it follows directly but is not stated outright.
- Tribute/cover nights, karaoke, "songs of X", "Candlelight: best of X" are NOT shows by X.`;

export async function aiExtract(g: Gemini, p: { text: string; url: string; today: string; artistHints: string[]; priority: CallPriority; cacheKey: string }): Promise<CallResult<Extraction>> {
  return g.call({
    task: "extract",
    priority: p.priority,
    cacheKey: p.cacheKey,
    schema: ExtractionZ,
    system: `You extract live music show announcements in India from web text for a concert alert app.${TRUTH_RULES}
Return is_event_announcement=false and events=[] if the text is not announcing a specific upcoming show/festival in India.
Only include events in India. One entry per distinct show (city+date). Today is ${p.today} (IST).`,
    input: `Artists the user follows (for spelling only; do not assume they are in the text): ${p.artistHints.slice(0, 40).join(", ")}
SOURCE URL: ${p.url}
SOURCE TEXT:
"""
${p.text.slice(0, 12000)}
"""`,
  });
}

export async function aiVision(g: Gemini, p: { image: { mimeType: string; base64: string }; caption: string; today: string; artistHints: string[] }): Promise<CallResult<Extraction>> {
  return g.call({
    task: "vision",
    priority: "high",
    schema: ExtractionZ,
    system: `You read concert posters and screenshots (Instagram posts, ticket pages) for an India concert alert app.${TRUTH_RULES}
For evidence fields, quote the exact text printed on the image (or in the caption). Today is ${p.today} (IST).`,
    input: [
      { type: "text", text: `Artists the user follows: ${p.artistHints.slice(0, 60).join(", ")}\nCaption/notes from user: ${p.caption || "(none)"}` },
      { type: "image", mime_type: p.image.mimeType, data: p.image.base64 },
    ],
  });
}

export async function aiVerify(g: Gemini, p: { candidate: Candidate; text: string; cacheKey: string; priority: CallPriority }): Promise<CallResult<Verification>> {
  return g.call({
    task: "verify",
    priority: p.priority,
    cacheKey: p.cacheKey,
    schema: VerificationZ,
    system: `You are a strict fact-checker. For each field path in the extracted JSON, decide if the SOURCE TEXT supports it.
Return supported=false unless you can quote the exact supporting words from the source. Quote verbatim in "quote".
Check especially: date, show_time, venue, city, every tier's availability, price, sale_start_*, sale_end_*, quantity_note.`,
    input: `EXTRACTED:\n${JSON.stringify(p.candidate)}\n\nSOURCE TEXT:\n"""\n${p.text.slice(0, 12000)}\n"""`,
  });
}

export async function aiResolve(g: Gemini, p: { artist: string; genres: string[]; isInternational: boolean; text: string; cacheKey: string }): Promise<CallResult<Resolution>> {
  return g.call({
    task: "resolve",
    priority: "normal",
    cacheKey: p.cacheKey,
    schema: ResolutionZ,
    system: `Decide whether a text refers to a specific music artist performing, versus a namesake (venue, mall, unrelated person, common word) or a tribute/cover act.
Quote the words that decide it in "evidence". If unclear, same_artist=false with low confidence.`,
    input: `ARTIST: ${p.artist} (${p.isInternational ? "international act" : "Indian artist"}; genres: ${p.genres.join(", ") || "unknown"})\nTEXT:\n"""\n${p.text.slice(0, 4000)}\n"""`,
  });
}

export async function aiWhisper(g: Gemini, p: { artist: string; text: string; url: string; cacheKey: string }): Promise<CallResult<WhisperOut>> {
  return g.call({
    task: "whisper",
    priority: "low",
    cacheKey: p.cacheKey,
    schema: WhisperZ,
    system: `Classify whether a text is a PRE-ANNOUNCEMENT SIGNAL that an artist may soon play India:
nearby_dates (Asia/Middle East dates announced), promoter_teaser, india_soon ("India dates soon"), coming_soon_page (ticket "notify me").
It is NOT a signal if it is an actual India show announcement, old news, a rumour with no source, or unrelated.
Precision matters more than recall: if in doubt, is_signal=false. confidence in [0,1]. Quote verbatim.`,
    input: `ARTIST: ${p.artist}\nURL: ${p.url}\nTEXT:\n"""\n${p.text.slice(0, 4000)}\n"""`,
  });
}

export async function aiWhy(g: Gemini, p: { facts: Record<string, unknown>; cacheKey: string }): Promise<CallResult<z.infer<typeof WhyZ>>> {
  return g.call({
    task: "why",
    priority: "low",
    cacheKey: p.cacheKey,
    schema: WhyZ,
    temperature: 0.3,
    system: `Write ONE short line (max 120 chars) telling a fan why this alert matters to him, using ONLY the given facts. No emojis, no hype, no new facts.`,
    input: JSON.stringify(p.facts),
  });
}

export async function aiScout(g: Gemini, p: { artists: { name: string; international: boolean }[]; today: string; extraQuery?: string }): Promise<CallResult<Scout>> {
  const list = p.artists.map((a) => `- ${a.name}`).join("\n");
  return g.call({
    task: "scout",
    grounded: true,
    priority: "normal",
    schema: ScoutZ,
    system: `You monitor concert announcements in India using Google Search. Today is ${p.today} (IST).
For each artist, search for upcoming live shows in India (any city; Bengaluru/Bangalore most important), festival lineups, and India tour announcements.
Prefer ticketing pages (district.in, in.bookmyshow.com, skillboxes.com, ticketgenie.in), promoters, venues and the artist's official channels.
kind="india_show" only for a specific announced upcoming show in India with a source; kind="signal" for pre-announcement hints
(nearby Asia/Middle East dates, "India dates soon", "notify me" pages); kind="none" if nothing found.
source_url must be the page that states it; quote must be copied from that page/snippet. Never invent dates, venues or URLs.
Ignore past shows, tribute/cover events and namesakes.`,
    input: `Artists:\n${list}${p.extraQuery ? `\nAlso check: ${p.extraQuery}` : ""}`,
  });
}

export { CandidateZ };
