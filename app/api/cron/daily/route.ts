import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { runDaily } from "@/lib/scheduler/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron (Hobby: once a day, 03:30 UTC ≈ 09:00 IST). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDaily(getRepo()));
}
