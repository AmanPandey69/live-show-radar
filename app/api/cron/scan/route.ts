import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { runLane } from "@/lib/scheduler/lanes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** External scheduler entry point: POST /api/cron/scan?lane=fast|deep with `Authorization: Bearer $CRON_SECRET`. */
async function handle(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const lane = new URL(req.url).searchParams.get("lane") === "deep" ? "deep" : "fast";
  const res = await runLane(getRepo(), lane, { budgetMs: 270_000 });
  return NextResponse.json({ lane: res.lane, status: res.status, stats: res.stats, log: res.log.slice(-25) });
}
export const POST = handle;
export const GET = handle;
