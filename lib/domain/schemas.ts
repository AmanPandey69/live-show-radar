import { z } from "zod";

/**
 * Candidate = one source's claim about one show, before dedupe/merge.
 * Every fact carries the verbatim evidence quote it came from; facts without evidence are dropped.
 * Dates/times are IST wall-clock strings (deterministically converted to UTC later), never model-computed UTC.
 */

const evidence = z.string().min(3).max(600);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const FieldConfidenceZ = z.enum(["confirmed", "inferred", "unknown"]);

export const TierZ = z.object({
  tier_type: z.enum(["early_bird", "phase_1", "presale_card", "presale_membership", "general", "vip"]),
  name_raw: z.string().min(1).max(120),
  price_inr_min: z.number().int().positive().nullable(),
  price_inr_max: z.number().int().positive().nullable(),
  sale_start_date: localDate.nullable(),
  sale_start_time: localTime.nullable(),
  sale_end_date: localDate.nullable(),
  sale_end_time: localTime.nullable(),
  quantity_note: z.string().max(120).nullable(),
  availability: z.enum(["open", "upcoming", "closed", "sold_out", "unknown"]),
  evidence,
  field_confidence: FieldConfidenceZ,
});
export type TierCandidate = z.infer<typeof TierZ>;

export const CandidateZ = z.object({
  artists: z.array(z.object({ name: z.string().min(1).max(120), role: z.enum(["headliner", "support"]), evidence })).min(1).max(30),
  title: z.string().min(1).max(200),
  is_festival: z.boolean(),
  festival_name: z.string().max(120).nullable(),
  venue: z.string().max(160).nullable(),
  venue_evidence: evidence.nullable(),
  city: z.string().min(2).max(60),
  city_evidence: evidence,
  date: localDate.nullable(),
  date_evidence: evidence.nullable(),
  show_time: localTime.nullable(),
  doors_time: localTime.nullable(),
  time_evidence: evidence.nullable(),
  status_signal: z.enum(["none", "cancelled", "postponed", "sold_out", "rumoured"]),
  status_evidence: evidence.nullable(),
  ticket_url: z.string().url().nullable(),
  tiers: z.array(TierZ).max(20),
  other_india_cities: z.array(z.string().max(60)).max(20),
  bengaluru_mention: z.string().max(300).nullable(), // only when the source text says something about Bengaluru dates
});
export type Candidate = z.infer<typeof CandidateZ>;

/** What an adapter emits per fetched item. `candidate` is set when the adapter parsed structured data itself. */
export interface ObservationInput {
  source_id: string;
  url: string;
  fetched_at: string;
  published_at: string | null;
  content_hash: string;
  title: string | null;
  text: string; // full readable text (not stored in full, used for extraction + evidence checks)
  snippet: string | null;
  candidate: Candidate | null; // deterministic parse (e.g. JSON-LD), skips Gemini extraction
  is_primary: boolean;
  is_demo?: boolean;
  image?: { mimeType: string; base64: string } | null; // posters (Telegram share)
}

export const ExtractionZ = z.object({
  is_event_announcement: z.boolean(),
  events: z.array(CandidateZ).max(10),
});
export type Extraction = z.infer<typeof ExtractionZ>;

export const VerificationZ = z.object({
  fields: z.array(
    z.object({
      path: z.string(), // e.g. "date", "venue", "tiers[0].sale_end_date"
      supported: z.boolean(),
      quote: z.string().max(600).nullable(),
    }),
  ),
  overall_supported: z.boolean(),
});
export type Verification = z.infer<typeof VerificationZ>;

export const ResolutionZ = z.object({
  same_artist: z.boolean(),
  is_tribute_or_cover: z.boolean(),
  role: z.enum(["headliner", "support", "unclear"]),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(600),
});
export type Resolution = z.infer<typeof ResolutionZ>;

export const ScoutZ = z.object({
  findings: z.array(
    z.object({
      artist: z.string(),
      kind: z.enum(["india_show", "signal", "none"]),
      title: z.string().max(200),
      city: z.string().max(60).nullable(),
      date: localDate.nullable(),
      venue: z.string().max(160).nullable(),
      source_url: z.string(),
      quote: z.string().max(600),
    }),
  ).max(25),
});
export type Scout = z.infer<typeof ScoutZ>;

export const WhisperZ = z.object({
  is_signal: z.boolean(),
  kind: z.enum(["nearby_dates", "promoter_teaser", "india_soon", "coming_soon_page", "other"]),
  summary: z.string().max(240),
  region: z.string().max(80).nullable(),
  confidence: z.number().min(0).max(1),
  quote: z.string().max(600),
});
export type WhisperOut = z.infer<typeof WhisperZ>;

export const WhyZ = z.object({ line: z.string().min(5).max(160) });
