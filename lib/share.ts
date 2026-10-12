import type { Repo } from "@/lib/db/repo";
import type { ObservationInput } from "@/lib/domain/schemas";
import { isPrimaryUrl } from "@/lib/domain/rules";
import { makeEngine } from "@/lib/scheduler/lanes";
import { obs } from "@/lib/sources/adapters/common";
import { PoliteHttp } from "@/lib/sources/http";
import { extractJsonLd, isEvent, jsonLdImage, jsonLdToCandidate } from "@/lib/sources/parse/jsonld";
import { htmlToText, sha256 } from "@/lib/text/normalize";

const LOGIN_WALLED = /instagram\.com|facebook\.com|fb\.watch|threads\.net|x\.com|twitter\.com/i;

export interface ShareResult { ok: boolean; message: string; eventIds: string[] }

/**
 * Share-to-Radar: Karan pastes a ticket link, an announcement caption, or uploads a poster screenshot.
 * It runs through the same pipeline (Gemini vision/extraction → truth gate → merge → instant alert).
 * Instagram/X links are never fetched (login-walled): upload a screenshot instead.
 */
export async function shareToRadar(repo: Repo, input: { text: string; image?: { mimeType: string; base64: string } | null }): Promise<ShareResult> {
  const engine = await makeEngine(repo);
  const now = new Date();
  const text = input.text.trim();
  const url = /(https?:\/\/\S+)/.exec(text)?.[1] ?? null;
  let o: ObservationInput | null = null;

  if (input.image) {
    const h = sha256(input.image.base64);
    o = { ...obs({ source_id: "share", url: url ?? `share:poster:${h.slice(0, 16)}`, text: text || "(poster image)", title: "Shared poster", is_primary: false, now, hashExtra: h }), image: input.image };
  } else if (url && LOGIN_WALLED.test(url)) {
    const rest = text.replace(url, "").trim();
    if (rest.length < 20) return { ok: false, message: "Instagram/X pages are login-walled and never fetched. Upload a screenshot of the post or paste its caption.", eventIds: [] };
    o = obs({ source_id: "share", url, text: rest, title: rest.split("\n")[0], is_primary: false, now });
  } else if (url) {
    try {
      const page = await new PoliteHttp(repo).get(url, { minIntervalMs: 0 });
      const ev = extractJsonLd(page.body).find(isEvent);
      const cand = ev ? jsonLdToCandidate(ev, url, now) : null;
      const body = cand ? JSON.stringify(ev) : htmlToText(page.body).slice(0, 12000);
      o = { ...obs({ source_id: "share", url, text: `${text}\n${body}`, title: cand?.title ?? text.slice(0, 120), candidate: cand, is_primary: isPrimaryUrl(url), now }), image_url: ev ? jsonLdImage(ev) : null };
    } catch (e) {
      return { ok: false, message: `Couldn't fetch that link politely (${(e as Error).message.slice(0, 120)}). Paste the text or upload a screenshot instead.`, eventIds: [] };
    }
  } else if (text.length > 15) {
    o = obs({ source_id: "share", url: `share:text:${sha256(text).slice(0, 16)}`, text, title: text.split("\n")[0], is_primary: false, now });
  } else {
    return { ok: false, message: "Paste an event link or announcement text, or upload a poster.", eventIds: [] };
  }

  const r = await engine.ingest(o);
  if (r.status === "merged") return { ok: true, message: `Added to the radar (${r.events.filter((e) => e.isNew).length} new, ${r.events.filter((e) => !e.isNew).length} updated).`, eventIds: r.events.map((e) => e.id) };
  if (r.status === "unchanged") return { ok: true, message: "Already on the radar: nothing new in that share.", eventIds: [] };
  return { ok: false, message: `Not added: ${r.reason ?? r.status}. Only India shows by artists you follow are tracked; tribute/cover nights are ignored.`, eventIds: [] };
}
