import { buildIcs } from "@/lib/alerts/ics";
import { env } from "@/lib/config/env";
import { getRepo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const e = await repo.getEvent(id);
  if (!e) return new Response("not found", { status: 404 });
  const [tiers, artists] = await Promise.all([repo.listTiers([id]), repo.listArtists()]);
  const title = [...e.headliner_ids].map((x) => artists.find((a) => a.id === x)?.name ?? "?").join(" + ") + ` @ ${e.venue_name_raw ?? e.city}`;
  const body = buildIcs(e, tiers, (e.is_demo ? "[SAMPLE] " : "") + title, `${env().APP_BASE_URL.replace(/\/$/, "")}/event/${e.id}`);
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="show-${id.slice(0, 8)}.ics"` } });
}
