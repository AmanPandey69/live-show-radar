import type { Artist, ArtistAlias, ArtistBlock } from "@/lib/domain/types";
import { artistKey } from "./normalize";

/**
 * Deterministic artist matcher: alias regex + namesake/tribute guard.
 * Uncertain cases (common-word names without context, possible namesakes) are flagged `needs_resolution`
 * so the pipeline can ask Gemini (entity resolution) instead of guessing.
 */

export interface ArtistMatch {
  artist_id: string;
  artist_name: string;
  alias: string;
  index: number;
  evidence: string;
  role: "headliner" | "support";
  blocked: null | { reason: "tribute" | "namesake" | "feedback" | "rule"; pattern: string };
  needs_resolution: boolean;
}

// Single words that are also everyday English: a bare match is not enough.
const COMMON_WORDS = new Set([
  "nothing", "low", "live", "local", "train", "japan", "yes", "love", "sun", "war", "hope", "home", "blue", "kites",
  "indian ocean", "eastern", "fire", "ocean", "space", "camp", "earth", "air", "magic", "freedom", "journey",
  "boston", "chicago", "america", "europe", "kansas", "smash", "bloom", "echo", "fever", "trees", "time", "maroon",
  "dream", "dreams", "rain", "muse", "phoenix", "local train", "divine", "mali", "agnee", "komorebi",
]);
const MUSIC_CONTEXT = /\b(supported by|support act|opening act|concert|live|tour|gig|tickets?|show|perform(?:s|ing|ance)?|band|singer|rapper|dj|album|single|festival|line-?up|headlin\w*|on stage|india leg|setlist|music)\b/i;
const TRIBUTE_RE = /\b(tribute|tributes|homage|covers? (?:band|night|show|set)|cover songs|covers night|songs of|music of|hits of|best of|celebrating|candlelight|karaoke|unplugged covers|orchestral rendition|reimagined by|ft\.? songs|night of)\b/i;
const SUPPORT_RE = /\b(supported by|support(?:ing)? act|support:|opening act|opener|openers|opening for|special guests?|with guests?|also featuring|undercard)\b/i;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string): RegExp {
  const tokens = artistKey(alias).split(" ").filter(Boolean).map((t) => (t === "and" ? "(?:and|&|n)" : escapeRe(t)));
  // "The Local Train" / "Local Train" / "Local-Train" / "local_train"
  const body = tokens.join("[\\s\\-_.'’]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:the[\\s\\-_]+)?${body}(?![\\p{L}\\p{N}])`, "giu");
}

const stripDiacritics = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

export interface MatcherInput {
  artists: Pick<Artist, "id" | "name" | "enabled">[];
  aliases: Pick<ArtistAlias, "artist_id" | "alias">[];
  blocks: Pick<ArtistBlock, "artist_id" | "pattern" | "reason">[];
}

export class ArtistMatcher {
  private entries: { artist_id: string; artist_name: string; alias: string; re: RegExp; common: boolean }[] = [];
  private blocks: MatcherInput["blocks"];

  constructor(input: MatcherInput) {
    this.blocks = input.blocks;
    const byArtist = new Map<string, Set<string>>();
    for (const a of input.artists) {
      if (!a.enabled) continue;
      byArtist.set(a.id, new Set([a.name]));
    }
    for (const al of input.aliases) byArtist.get(al.artist_id)?.add(al.alias);
    const names = new Map(input.artists.map((a) => [a.id, a.name]));
    for (const [id, aliases] of byArtist) {
      for (const alias of aliases) {
        const key = artistKey(alias);
        if (key.length < 2) continue;
        this.entries.push({
          artist_id: id,
          artist_name: names.get(id)!,
          alias,
          re: aliasPattern(alias),
          common: COMMON_WORDS.has(key) || COMMON_WORDS.has(artistKey(names.get(id)!)) || key.length <= 3,
        });
      }
    }
    // Longest aliases first so "The Local Train" wins over a hypothetical "Train".
    this.entries.sort((a, b) => b.alias.length - a.alias.length);
  }

  /** Cheap boolean used by pre-filters on slugs/titles (lenient: lowercase slugs allowed; strict check happens later). */
  anyMatch(text: string): boolean {
    return this.match(text, { lenient: true }).some((m) => !m.blocked);
  }

  match(rawText: string, opts: { lenient?: boolean } = {}): ArtistMatch[] {
    const text = stripDiacritics(rawText);
    const found = new Map<string, ArtistMatch>();
    const taken: [number, number][] = [];
    for (const e of this.entries) {
      e.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = e.re.exec(text))) {
        const start = m.index;
        const end = start + m[0].length;
        if (taken.some(([s, t]) => start < t && end > s)) continue; // overlaps a longer alias
        const window = text.slice(Math.max(0, start - 90), Math.min(text.length, end + 90));
        const before = text.slice(Math.max(0, start - 60), start);
        let needs_resolution = false;
        if (e.common) {
          const capitalised = /\p{Lu}/u.test(m[0]);
          if ((!capitalised && !opts.lenient) || !MUSIC_CONTEXT.test(window)) continue; // everyday word, not the artist
          // Exact, case-matched multi-word canonical name ("The Local Train") is strong; anything else goes to AI resolution.
          const exactCanonical = m[0] === e.artist_name && e.artist_name.trim().includes(" ");
          needs_resolution = !exactCanonical;
        }
        const blocked = this.blockFor(e.artist_id, e.alias, window, text, start, end);
        const role: ArtistMatch["role"] = SUPPORT_RE.test(before) ? "support" : "headliner";
        taken.push([start, end]);
        const prev = found.get(e.artist_id);
        if (!prev || (prev.blocked && !blocked)) {
          found.set(e.artist_id, {
            artist_id: e.artist_id,
            artist_name: e.artist_name,
            alias: e.alias,
            index: start,
            evidence: window.replace(/\s+/g, " ").trim(),
            role: prev && prev.role === "headliner" ? "headliner" : role,
            blocked,
            needs_resolution,
          });
        }
      }
    }
    return [...found.values()].sort((a, b) => a.index - b.index);
  }

  private blockFor(artistId: string, alias: string, window: string, text: string, start: number, end: number): ArtistMatch["blocked"] {
    const lw = window.toLowerCase();
    // "<artist> tribute", "tribute to <artist>", "songs of <artist>", "The <artist> Experience"
    const near = text.slice(Math.max(0, start - 45), Math.min(text.length, end + 30));
    if (TRIBUTE_RE.test(near)) return { reason: "tribute", pattern: (TRIBUTE_RE.exec(near)?.[0] ?? "tribute").toLowerCase() };
    if (new RegExp(`${escapeRe(alias)}\\s+experience\\b`, "i").test(text.slice(start, end + 15))) {
      return { reason: "tribute", pattern: "experience" };
    }
    for (const b of this.blocks) {
      if (b.artist_id && b.artist_id !== artistId) continue;
      if (lw.includes(b.pattern.toLowerCase())) return { reason: b.reason, pattern: b.pattern };
    }
    return null;
  }
}
