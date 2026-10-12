import { loadEnvFile } from "./load-env";
loadEnvFile();
/** One short text call through the AI gateway (Google model via OpenRouter). Prints model, reply, tokens, cost. Never prints the key. */
const { MemoryRepo } = await import("../lib/db/memory");
const { Gemini } = await import("../lib/ai/gemini");
const { z } = await import("zod");
const repo = new MemoryRepo();
const g = Gemini.fromEnv(repo);
const r = await g.call({ task: "why", system: "Reply in JSON.", input: 'Say hello to Karan in one short line. Return {"line": "..."}', schema: z.object({ line: z.string() }) });
const usage = await repo.listGeminiUsage("2000-01-01");
console.log(JSON.stringify({ model: g.model, ok: r.ok, reply: r.ok ? r.data.line : r, usage: usage.map((u) => ({ status: u.status, in: u.input_tokens, out: u.output_tokens, ms: u.latency_ms, err: u.error })) }, null, 2));
