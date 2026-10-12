import type { Env } from "@/lib/config/env";
import type { Repo } from "@/lib/db/repo";
import type { ObservationInput } from "@/lib/domain/schemas";
import type { Artist, SourceKind } from "@/lib/domain/types";
import type { ArtistMatcher } from "@/lib/text/match";
import type { Http } from "./http";

export type Lane = "fast" | "deep" | "daily" | "manual" | "replay";
export type Capability = "listing" | "event_page" | "news" | "search" | "share" | "whisper" | "official";

export interface AdapterContext {
  repo: Repo;
  http: Http;
  matcher: ArtistMatcher;
  artists: Artist[];
  now: Date;
  lane: Lane;
  deadline: number; // epoch ms; adapters stop early and resume next run (cursor in kv)
  log: (msg: string) => void;
}

/** Every source implements this. `fetchNew` returns only new/changed items (hash-gated upstream too). */
export interface SourceAdapter {
  id: string;
  name: string;
  kind: SourceKind;
  is_primary: boolean;
  capabilities: Capability[];
  rateLimit: { minIntervalMs: number };
  lanes: Lane[];
  /** null = enabled; string = why disabled (shown on /health). */
  disabledReason(env: Env): string | null;
  fetchNew(ctx: AdapterContext): Promise<ObservationInput[]>;
}
