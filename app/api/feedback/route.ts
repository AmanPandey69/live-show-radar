import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import type { FeedbackKind } from "@/lib/domain/types";
import { applyFeedback } from "@/lib/feedback";

const KINDS = ["going", "maybe", "not_interested", "wrong_artist", "wrong_info"];

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/settings", req.url), 303);
  const f = await req.formData();
  const kind = String(f.get("kind"));
  const event_id = String(f.get("event_id"));
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  await applyFeedback(getRepo(), { event_id, kind: kind as FeedbackKind, channel: "web" });
  return NextResponse.redirect(new URL(`/event/${event_id}`, req.url), 303);
}
