import type { Availability, TierType } from "@/lib/domain/types";
import { parseIndianDate, type LocalDate } from "./dates-ist";

/**
 * Deterministic early-bird / tier phrase parser. It never invents values: every field is either
 * read from the phrase (with the phrase as evidence) or left null / "unknown".
 */
export interface TierSignal {
  tier_type: TierType | null;
  name_raw: string;
  availability: Availability;
  availability_basis: "stated" | "inferred" | "unknown";
  sale_start: LocalDate | null;
  sale_end: LocalDate | null;
  quantity_note: string | null;
  presale_partner: string | null;
  evidence: string;
}

const CARD_WORDS = /\b(hdfc|icici|axis|kotak|sbi|amex|american express|au bank|au small finance|yes bank|rbl|idfc|indusind|hsbc|sc bank|standard chartered|visa|mastercard|rupay|credit card|debit card|card ?holders?|card ?members?)\b/i;
const MEMBER_WORDS = /\b(members?(?:hip)?|fan ?club|fan presale|artist presale|district pass|zomato gold|prime|insider|pass ?holders?|newsletter|sign[- ]?ups?|registered (?:fans|users))\b/i;

export function classifyTier(text: string): TierType | null {
  const t = text.toLowerCase();
  if (/\bearly[\s-]*birds?\b|\bearly[\s-]*access\b|\bblind (?:bird|tickets?)\b|\beb\b/.test(t)) return "early_bird";
  if (/\bpre[\s-]?sales?\b|\bpre[\s-]?registration\b|\bpriority access\b/.test(t)) {
    if (CARD_WORDS.test(t)) return "presale_card";
    if (MEMBER_WORDS.test(t)) return "presale_membership";
    return /\bcard\b/.test(t) ? "presale_card" : "presale_membership";
  }
  if (CARD_WORDS.test(t) && /\b(exclusive|access|window|offer)\b/.test(t)) return "presale_card";
  if (/\b(phase|tier|wave|round|release)\s*[-:]?\s*(1|i|one)\b|\b(first|1st) (release|phase|tier|wave)\b/.test(t)) return "phase_1";
  if (/\bvip\b|\blounge\b|\bfan ?pit\b|\bbackstage\b|\bmeet\s*(?:&|and)?\s*greet\b|\bm&g\b|\bplatinum\b|\bdiamond\b/.test(t)) return "vip";
  if (/\bgeneral\b|\bga\b|\bregular\b|\bstandard\b|\b(phase|tier|wave)\s*[-:]?\s*(2|3|4|ii|iii|two|three)\b|\bfinal release\b/.test(t)) return "general";
  return null;
}

function presalePartner(text: string): string | null {
  const m = CARD_WORDS.exec(text);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (/card|holder|member|visa|mastercard|rupay/.test(w)) return null; // generic, not a named partner
  return m[1].toUpperCase().replace("AMERICAN EXPRESS", "AMEX");
}

function quantityNote(text: string): string | null {
  const t = text.toLowerCase();
  let m = /\b(first|only|just)\s+(\d{2,5})\s*(tickets?|passes|seats|fans)?\b/.exec(t);
  if (m) return `${m[1]} ${m[2]} ${m[3] ?? "tickets"}`.trim();
  m = /\b(limited(?:\s+(?:quantity|quantities|seats|tickets|passes|inventory|window|time|period|slots|early access))?|while stocks last|selling fast|last few|few left|almost gone|fast filling|filling fast)\b/.exec(t);
  return m ? m[1] : null;
}

const START_WORDS = /\b(opens?|opening|goes live|go(?:es)? on sale|on sale (?:from|on|at)|live (?:from|on|at)|starts?|starting|begins?|sale begins|unlocks?|drops?|available from|releases?)\b/i;
const END_WORDS = /\b(till|until|upto|up to|ends?|ending|closes?|closing|valid (?:till|until|through)|last date|deadline|expires?|before)\b/i;

/** Parse one phrase/line. `ref` resolves relative dates ("opens Saturday 10am"). */
export function parseTierPhrase(phrase: string, ref: Date = new Date()): TierSignal {
  const text = phrase.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const tier_type = classifyTier(text);
  const sig: TierSignal = {
    tier_type,
    name_raw: text.length > 80 ? text.slice(0, 80) : text,
    availability: "unknown",
    availability_basis: "unknown",
    sale_start: null,
    sale_end: null,
    quantity_note: quantityNote(text),
    presale_partner: tier_type?.startsWith("presale") ? presalePartner(text) : null,
    evidence: text,
  };

  if (/\bsold[\s-]*out\b|\bhouse ?full\b|\bfully booked\b/.test(lower)) {
    sig.availability = "sold_out";
    sig.availability_basis = "stated";
    return sig;
  }
  if (/\b(closed|has ended|is over|no longer available|expired)\b/.test(lower)) {
    sig.availability = "closed";
    sig.availability_basis = "stated";
    return sig;
  }

  const startIdx = lower.search(START_WORDS);
  const endIdx = lower.search(END_WORDS);
  if (startIdx >= 0) sig.sale_start = parseIndianDate(text.slice(startIdx), ref);
  if (endIdx >= 0) sig.sale_end = parseIndianDate(text.slice(endIdx), ref);
  // If both keywords exist but share the same date match, keep only the one whose keyword is closer.
  if (sig.sale_start && sig.sale_end && sig.sale_start.match === sig.sale_end.match) {
    if (startIdx < endIdx) sig.sale_start = null;
    else sig.sale_end = null;
  }
  if (sig.sale_end && sig.sale_end.time === null) sig.sale_end = { ...sig.sale_end, time: "23:59" };

  const now = ref.getTime();
  const at = (d: LocalDate) => new Date(`${d.date}T${d.time ?? "00:00"}:00+05:30`).getTime();

  if (/\b(on sale now|available now|live now|open now|now open|now live|book now|is live|are live|selling fast|last few)\b/.test(lower)) {
    sig.availability = "open";
    sig.availability_basis = "stated";
  } else if (sig.sale_start && at(sig.sale_start) > now) {
    sig.availability = "upcoming";
    sig.availability_basis = "stated";
  } else if (sig.sale_end) {
    // "Early Bird till 15th Nov": open until the deadline (inferred, not stated as "open now").
    sig.availability = at(sig.sale_end) < now ? "closed" : "open";
    sig.availability_basis = "inferred";
  } else if (/\b(coming soon|notify me|stay tuned|announcing soon)\b/.test(lower)) {
    sig.availability = "upcoming";
    sig.availability_basis = "stated";
  }
  return sig;
}

const LINE_TRIGGER = /early[\s-]*bird|early[\s-]*access|pre[\s-]?sale|phase\s*[-:]?\s*\d|tier\s*[-:]?\s*\d|\b(first|1st) release|card ?holders?|tickets?\b.*\b(open|live|sale)|\bon sale\b|\bsale\b.*\b(opens?|starts?|begins?|live)\b|general (?:sale|admission)|sold[\s-]*out|\blimited\b/i;

/** Find tier-ish lines in a longer text (page, caption, article). */
export function findTierPhrases(text: string, ref: Date = new Date()): TierSignal[] {
  const lines = text
    .split(/\n|(?<=[.!?|•·])\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 300 && LINE_TRIGGER.test(l));
  return lines.map((l) => parseTierPhrase(l, ref)).filter((s) => s.tier_type || s.availability !== "unknown" || s.sale_start || s.sale_end);
}
