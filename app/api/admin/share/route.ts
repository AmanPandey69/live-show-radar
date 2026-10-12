import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { shareToRadar } from "@/lib/share";

export const maxDuration = 60;

/** Share-to-Radar web form: link / caption text / poster upload → real pipeline → instant alert. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const file = f.get("poster");
  let image: { mimeType: string; base64: string } | null = null;
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 4_000_000) return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent("Poster too large (max 4 MB)")}`, req.url), 303);
    image = { mimeType: file.type || "image/jpeg", base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
  }
  const r = await shareToRadar(getRepo(), { text: String(f.get("text") ?? ""), image });
  const dest = r.eventIds[0] ? `/event/${r.eventIds[0]}` : `/settings?msg=${encodeURIComponent(r.message)}`;
  return NextResponse.redirect(new URL(dest, req.url), 303);
}
