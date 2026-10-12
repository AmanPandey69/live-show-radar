import { NextResponse } from "next/server";
import { getRepo } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public, read-only feed for the in-app notification bell (no emails, chat ids or secrets). */
export async function GET() {
  const alerts = await getRepo().listAlerts({ limit: 60 });
  const items = alerts
    .filter((a) => !(a.payload as { bundled_into?: string }).bundled_into)
    .slice(0, 25)
    .map((a) => {
      const p = a.payload as { title?: string; facts?: string[]; summary?: string };
      const title = (p.title ?? a.text.split("\n")[0]).replace(/^\[DEMO\]\s*/, "").replace(/^(UNCONFIRMED|RUMOUR) · /, "");
      return {
        id: a.id, type: a.type, event_id: a.event_id, is_demo: a.is_demo, created_at: a.created_at,
        title: title.replace(/^[A-Z -]+ · P\d: /, ""),
        detail: p.facts?.join(" · ") ?? p.summary ?? a.text.split("\n").slice(1, 2).join(""),
      };
    });
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}
