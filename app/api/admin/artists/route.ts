import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";

/** Manual star override / enable toggle. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const id = String(f.get("id"));
  const action = String(f.get("action"));
  const repo = getRepo();
  const a = (await repo.listArtists()).find((x) => x.id === id);
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (action === "toggle") await repo.updateArtist(id, { enabled: !a.enabled });
  else if (["must_see", "like", "casual"].includes(action)) await repo.updateArtist(id, { affinity_override: action as "must_see" });
  return NextResponse.redirect(new URL("/artists", req.url), 303);
}
