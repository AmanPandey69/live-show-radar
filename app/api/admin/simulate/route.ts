import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { makeEngine } from "@/lib/scheduler/lanes";
import { simulateAnnouncement } from "@/lib/seed";

export const maxDuration = 120;

/** Admin "Simulate announcement": real pipeline, [DEMO]-labelled real message. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const engine = await makeEngine(getRepo());
  const r = await simulateAnnouncement(engine, f.get("artist") ? String(f.get("artist")) : undefined);
  const id = r.events[0]?.id;
  return NextResponse.redirect(new URL(id ? `/event/${id}` : `/settings?msg=${encodeURIComponent(`simulate: ${r.status} ${r.reason ?? ""}`)}`, req.url), 303);
}
