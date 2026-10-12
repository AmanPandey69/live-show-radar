import { citiesIn, mentionsIndia } from "./cities";
import { parseIndianDate } from "./dates-ist";
import type { ArtistMatch, ArtistMatcher } from "./match";

const EVENT_WORDS = /\b(concert|live|tour|gig|tickets?|show|festival|line-?up|perform\w*|headlin\w*|on sale|early[\s-]*bird|pre[\s-]?sale|book now|venue|stage)\b/i;
const WHISPER_WORDS = /\b(india (?:dates?|tour|shows?) (?:soon|coming|announced soon)|coming to india|see you (?:soon )?india|asia tour|south[- ]?east asia|middle east|dubai|abu dhabi|singapore|bangkok|jakarta|kuala lumpur|manila|hong kong|tokyo|seoul|taipei|colombo|kathmandu|dhaka|coming soon|notify me|stay tuned|watch this space)\b/i;

export interface PrefilterResult {
  pass: boolean;
  whisper: boolean; // artist + pre-announcement wording, no India show yet
  artists: ArtistMatch[];
  cities: string[];
  hasDate: boolean;
  reason: string;
}

/** Cheap, deterministic gate before any Gemini call. */
export function prefilter(text: string, matcher: ArtistMatcher, ref: Date = new Date()): PrefilterResult {
  const artists = matcher.match(text).filter((m) => !m.blocked);
  const blocked = matcher.match(text).filter((m) => m.blocked);
  const cities = citiesIn(text, { strict: true });
  const india = cities.length > 0 || mentionsIndia(text);
  const hasDate = parseIndianDate(text, ref) !== null;
  const eventy = EVENT_WORDS.test(text);
  const base = { artists, cities, hasDate };
  if (artists.length === 0) {
    return { ...base, pass: false, whisper: false, reason: blocked.length ? `blocked:${blocked[0].blocked!.reason}` : "no_artist" };
  }
  if (india && (hasDate || eventy)) return { ...base, pass: true, whisper: false, reason: "artist+india+event" };
  if (WHISPER_WORDS.test(text)) return { ...base, pass: false, whisper: true, reason: "whisper_wording" };
  return { ...base, pass: false, whisper: false, reason: india ? "no_event_words" : "not_india" };
}
