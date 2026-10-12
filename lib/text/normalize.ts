import { createHash } from "node:crypto";

/** Lowercase, strip diacritics, unify "&"/"and", punctuation → space, collapse whitespace. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Artist-name key: norm() and drop a leading "the". */
export function artistKey(s: string): string {
  return norm(s).replace(/^the /, "");
}

/** "papon-live-in-concert-bengaluru-2026-buy-tickets" → "papon live in concert bengaluru 2026 buy tickets" */
export function slugToText(url: string): string {
  try {
    const u = new URL(url);
    return norm(decodeURIComponent(u.pathname).replace(/[-_/]+/g, " "));
  } catch {
    return norm(url.replace(/[-_/]+/g, " "));
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Strip HTML to readable text (cheap; used before hashing and pre-filters). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Token-set similarity (Jaccard) over normalised tokens minus stopwords. */
export function tokenSimilarity(a: string, b: string, stop: Set<string> = VENUE_STOP): number {
  const ta = new Set(norm(a).split(" ").filter((t) => t && !stop.has(t)));
  const tb = new Set(norm(b).split(" ").filter((t) => t && !stop.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size); // overlap coefficient: "Phoenix Marketcity" ⊂ "Phoenix Marketcity Whitefield"
}

export const VENUE_STOP = new Set([
  "the", "at", "and", "of", "in", "bengaluru", "bangalore", "blr", "mumbai", "delhi", "new", "india",
  "venue", "grounds", "ground", "arena", "hall", "auditorium", "club", "bar", "pub", "live", "by",
]);

/** Short, quotable snippet around the first occurrence of `needle` (for evidence). */
export function snippetAround(text: string, needle: string, radius = 140): string | null {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}
