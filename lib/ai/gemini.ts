import { z } from "zod";
import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import type { Repo } from "@/lib/db/repo";
import { IST } from "@/lib/text/dates-ist";
import { sha256 } from "@/lib/text/normalize";

/**
 * The single gateway for every Gemini call (Interactions API, @google/genai).
 * Responsibilities: daily budget with priority reserve, content-hash cache, zod validation with one retry,
 * exponential backoff on 429 plus a cooldown, usage logging. Callers always get a typed result or a reason,
 * never an exception, so ingestion falls back to deterministic parsing instead of stopping.
 */

export const PROMPT_VERSION = "v1";

export type Task = "scout" | "extract" | "verify" | "vision" | "resolve" | "whisper" | "why";
export type CallPriority = "high" | "normal" | "low";

export interface Citation { url: string; title: string | null; cited_text: string | null }

export interface RawInteraction {
  output_text?: string;
  steps?: unknown[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number; grounding_tool_count?: { count?: number }[] };
}

export interface InteractionRequest {
  model: string;
  system_instruction: string;
  input: string | unknown[];
  tools?: { type: "google_search" }[];
  response_format: { type: "text"; mime_type: "application/json"; schema: Record<string, unknown> };
  generation_config: { temperature: number; thinking_level?: string; max_output_tokens?: number };
  store: false;
}

/** Thin seam over the SDK so tests can inject failures (429 storms) and canned outputs. */
export type Transport = (req: InteractionRequest) => Promise<RawInteraction>;

export class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function sdkTransport(apiKey: string): Transport {
  let client: unknown = null;
  return async (req) => {
    if (!client) {
      const { GoogleGenAI } = await import("@google/genai");
      client = new GoogleGenAI({ apiKey });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await (client as any).interactions.create(req)) as RawInteraction;
    } catch (e) {
      const err = e as { status?: number; code?: number; message?: string };
      const status = err.status ?? err.code ?? (/\b429\b|RESOURCE_EXHAUSTED/.test(String(err.message)) ? 429 : 0);
      throw new HttpStatusError(Number(status) || 0, String(err.message ?? e));
    }
  };
}

export type CallResult<T> =
  | { ok: true; data: T; citations: Citation[]; queries: string[]; cached: boolean }
  | { ok: false; reason: "disabled" | "budget" | "cooldown" | "rate_limited" | "invalid" | "error" | "no_grounding"; detail?: string };

/** zod → JSON Schema in the subset Gemini accepts (drops $schema, pattern, format, additionalProperties). */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "$schema" || k === "pattern" || k === "format" || k === "additionalProperties" || k === "~standard") continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(js) as Record<string, unknown>;
}

function extractCitations(steps: unknown[] | undefined): { citations: Citation[]; queries: string[] } {
  const citations: Citation[] = [];
  const queries: string[] = [];
  for (const s of (steps ?? []) as Record<string, unknown>[]) {
    if (s.type === "google_search_call") {
      const q = (s.arguments as { queries?: string[] } | undefined)?.queries ?? [];
      queries.push(...q);
    }
    if (s.type === "model_output") {
      for (const block of (s.content as Record<string, unknown>[] | undefined) ?? []) {
        const text = typeof block.text === "string" ? block.text : "";
        for (const a of (block.annotations as Record<string, unknown>[] | undefined) ?? []) {
          if (a.type !== "url_citation" || typeof a.url !== "string") continue;
          const si = Number(a.start_index ?? a.startIndex ?? -1);
          const ei = Number(a.end_index ?? a.endIndex ?? -1);
          citations.push({ url: a.url, title: typeof a.title === "string" ? a.title : null, cited_text: si >= 0 && ei > si ? text.slice(si, ei) : null });
        }
      }
    }
  }
  return { citations, queries };
}

const PRIORITY_SHARE: Record<CallPriority, number> = { high: 1, normal: 0.85, low: 0.6 };

export interface GeminiOptions {
  apiKey?: string;
  model: string;
  dailyCalls: number;
  dailyGrounded: number;
  groundingEnabled: boolean;
  transport?: Transport;
  sleep?: (ms: number) => Promise<void>;
}

export class Gemini {
  private transport: Transport | null;
  private sleep: (ms: number) => Promise<void>;
  constructor(private repo: Repo, private opts: GeminiOptions) {
    this.transport = opts.transport ?? (opts.apiKey ? sdkTransport(opts.apiKey) : null);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  static fromEnv(repo: Repo, transport?: Transport): Gemini {
    const e = env();
    return new Gemini(repo, {
      apiKey: e.MOCK_MODE ? undefined : e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      dailyCalls: e.GEMINI_DAILY_CALL_BUDGET,
      dailyGrounded: e.GEMINI_DAILY_GROUNDED_BUDGET,
      groundingEnabled: e.GEMINI_GROUNDING_ENABLED,
      transport,
    });
  }

  get enabled() { return !!this.transport; }
  get model() { return this.opts.model; }

  /** Budget window = the current IST calendar day. */
  static dayStartUtc(now = new Date()): string {
    return DateTime.fromJSDate(now).setZone(IST).startOf("day").toUTC().toISO()!;
  }

  async budgetStatus(now = new Date()) {
    const used = await this.repo.geminiCountsSince(Gemini.dayStartUtc(now));
    return { ...used, callBudget: this.opts.dailyCalls, groundedBudget: this.opts.dailyGrounded, model: this.opts.model, enabled: this.enabled, groundingEnabled: this.opts.groundingEnabled };
  }

  async call<T>(p: {
    task: Task;
    system: string;
    input: string | unknown[];
    schema: z.ZodType<T>;
    grounded?: boolean;
    priority?: CallPriority;
    cacheKey?: string; // usually the content hash; omit to skip caching
    temperature?: number;
  }): Promise<CallResult<T>> {
    const t0 = Date.now();
    const log = (status: "ok" | "error" | "invalid" | "budget_skip" | "cache_hit" | "rate_limited", extra: Partial<{ input_tokens: number; output_tokens: number; search_queries: number; error: string }> = {}) =>
      this.repo.logGemini({
        at: new Date().toISOString(), task: p.task, model: this.opts.model, grounded: !!p.grounded, status,
        input_tokens: extra.input_tokens ?? null, output_tokens: extra.output_tokens ?? null, search_queries: extra.search_queries ?? null,
        latency_ms: Date.now() - t0, error: extra.error ?? null,
      });

    if (!this.transport) return { ok: false, reason: "disabled" };
    if (p.grounded && !this.opts.groundingEnabled) return { ok: false, reason: "no_grounding", detail: "GEMINI_GROUNDING_ENABLED=false" };

    const key = p.cacheKey ? sha256(`${p.task}|${this.opts.model}|${PROMPT_VERSION}|${p.cacheKey}`) : null;
    if (key) {
      const hit = await this.repo.getGeminiCache(key);
      if (hit) {
        const parsed = p.schema.safeParse((hit as { data: unknown }).data);
        if (parsed.success) {
          await log("cache_hit");
          const h = hit as { citations?: Citation[]; queries?: string[] };
          return { ok: true, data: parsed.data, citations: h.citations ?? [], queries: h.queries ?? [], cached: true };
        }
      }
    }

    const cooldown = await this.repo.getKv<string>("gemini:cooldown_until");
    if (cooldown && Date.parse(cooldown) > Date.now()) return { ok: false, reason: "cooldown", detail: `until ${cooldown}` };

    const used = await this.repo.geminiCountsSince(Gemini.dayStartUtc());
    const share = PRIORITY_SHARE[p.priority ?? "normal"];
    if (used.calls >= this.opts.dailyCalls * share || (p.grounded && used.grounded >= this.opts.dailyGrounded * share)) {
      await log("budget_skip");
      return { ok: false, reason: "budget", detail: `${used.calls}/${this.opts.dailyCalls} calls, ${used.grounded}/${this.opts.dailyGrounded} grounded` };
    }

    const req: InteractionRequest = {
      model: this.opts.model,
      system_instruction: p.system,
      input: p.input,
      response_format: { type: "text", mime_type: "application/json", schema: toGeminiSchema(p.schema) },
      generation_config: { temperature: p.temperature ?? 0.1, thinking_level: "low" },
      store: false,
      ...(p.grounded ? { tools: [{ type: "google_search" as const }] } : {}),
    };

    let lastErr = "";
    let validationRetry = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let raw: RawInteraction;
      try {
        raw = await this.transport(req);
      } catch (e) {
        const status = e instanceof HttpStatusError ? e.status : 0;
        lastErr = (e as Error).message.slice(0, 300);
        if (status === 429 || status === 503) {
          if (attempt < 3) {
            await this.sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 250));
            continue;
          }
          await log("rate_limited", { error: lastErr });
          await this.repo.setKv("gemini:cooldown_until", new Date(Date.now() + 10 * 60_000).toISOString());
          return { ok: false, reason: "rate_limited", detail: lastErr };
        }
        await log("error", { error: lastErr });
        return { ok: false, reason: "error", detail: lastErr };
      }

      const { citations, queries } = extractCitations(raw.steps);
      const usage = {
        input_tokens: raw.usage?.total_input_tokens,
        output_tokens: raw.usage?.total_output_tokens,
        search_queries: p.grounded ? raw.usage?.grounding_tool_count?.reduce((s, g) => s + (g.count ?? 0), 0) ?? queries.length : undefined,
      };
      let json: unknown;
      try {
        json = JSON.parse((raw.output_text ?? "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        json = undefined;
      }
      const parsed = p.schema.safeParse(json);
      if (parsed.success) {
        await log("ok", usage);
        if (key) await this.repo.setGeminiCache(key, p.task, { data: parsed.data, citations, queries });
        return { ok: true, data: parsed.data, citations, queries, cached: false };
      }
      lastErr = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await log("invalid", { ...usage, error: lastErr });
      if (validationRetry) break; // retry once only
      validationRetry = true;
      req.input = typeof p.input === "string"
        ? `${p.input}\n\nYour previous answer failed validation (${lastErr}). Return ONLY JSON matching the schema.`
        : p.input;
    }
    return { ok: false, reason: "invalid", detail: lastErr };
  }
}
