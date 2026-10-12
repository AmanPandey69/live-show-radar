import type { Candidate, ObservationInput } from "@/lib/domain/schemas";
import { sha256 } from "@/lib/text/normalize";

/** Bump when parsing/extraction logic changes: previously seen pages are re-processed once (alerts stay deduped). */
export const PIPELINE_VERSION = "2026-10-12.3";

export function obs(p: {
  source_id: string;
  url: string;
  text: string;
  title?: string | null;
  snippet?: string | null;
  published_at?: string | null;
  candidate?: Candidate | null;
  is_primary: boolean;
  now: Date;
  hashExtra?: string;
}): ObservationInput {
  return {
    source_id: p.source_id,
    url: p.url,
    fetched_at: p.now.toISOString(),
    published_at: p.published_at ?? null,
    content_hash: sha256(`${PIPELINE_VERSION}|${p.text}|${p.hashExtra ?? ""}`),
    title: p.title ?? null,
    text: p.text,
    snippet: p.snippet ?? (p.text.length > 280 ? `${p.text.slice(0, 280)}…` : p.text),
    candidate: p.candidate ?? null,
    is_primary: p.is_primary,
  };
}

/** Round-robin cursor stored in kv so each run continues where the last one stopped. */
export async function rotate<T>(repo: { getKv<X>(k: string): Promise<X | null>; setKv(k: string, v: unknown): Promise<void> }, key: string, items: T[], n: number): Promise<T[]> {
  if (items.length === 0) return [];
  const start = ((await repo.getKv<number>(key)) ?? 0) % items.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(n, items.length); i++) out.push(items[(start + i) % items.length]);
  await repo.setKv(key, (start + out.length) % items.length);
  return out;
}

export const timeLeft = (deadline: number, reserveMs = 8000) => deadline - Date.now() > reserveMs;
