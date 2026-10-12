import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { runLane } from "@/lib/scheduler/lanes";

export const maxDuration = 300;

/** Admin "Scan now". */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const lane = f.get("lane") === "deep" ? "deep" : "manual";
  const res = await runLane(getRepo(), lane, { budgetMs: 240_000 });
  const url = new URL("/settings", req.url);
  url.searchParams.set("msg", `${res.lane} scan ${res.status}: ${JSON.stringify(res.stats.adapters ?? res.stats).slice(0, 300)}`);
  return NextResponse.redirect(url, 303);
}
