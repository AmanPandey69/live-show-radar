import { NextResponse } from "next/server";
import { getRepo } from "@/lib/db";
import { hasGemini, hasTelegram, hasEmail, hasDb, env } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/** Public health probe: no secrets, no chat ids, no emails. */
export async function GET() {
  const repo = getRepo();
  try {
    const [hb, health, runs, events] = await Promise.all([repo.getKv<{ at: string; lane: string }>("heartbeat"), repo.listHealth(), repo.listRuns(1), repo.listEvents({ includeDemo: false, limit: 500 })]);
    return NextResponse.json({
      ok: true,
      db: repo.kind,
      configured: { db: hasDb(), ai: hasGemini(), telegram: hasTelegram(), email: hasEmail(), model: env().GEMINI_MODEL },
      heartbeat: hb,
      last_run: runs[0] ? { lane: runs[0].lane, status: runs[0].status, started_at: runs[0].started_at } : null,
      real_events: events.length,
      sources: health.map((h) => ({ id: h.source_id, status: h.status, last_ok_at: h.last_ok_at })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
