import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";

/**
 * Artist fallbacks when Spotify isn't connected: paste names (one per line), Spotify artist URLs, or a CSV
 * (first column = name). Spotify URLs keep the id; names are resolved on the next Spotify sync.
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const raw = String(f.get("text") ?? "");
  const file = f.get("file");
  const text = raw + "\n" + (file && typeof file !== "string" ? await file.text() : "");
  const repo = getRepo();
  let n = 0;
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const sp = /open\.spotify\.com\/artist\/([A-Za-z0-9]+)/.exec(line);
    if (sp) {
      const label = line.replace(/https?:\/\/\S+/, "").replace(/[,\s]+$/, "").trim();
      await repo.upsertArtist({ name: label || `spotify:${sp[1]}`, spotify_id: sp[1], origin: "url" });
      n++;
      continue;
    }
    const name = line.split(",")[0].replace(/^"|"$/g, "").trim();
    if (!name || /^(name|artist|artist name)$/i.test(name)) continue;
    const a = await repo.upsertArtist({ name, origin: raw.includes(line) ? "manual" : "csv" });
    await repo.addAlias(a.id, name, "canonical");
    n++;
  }
  return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`imported ${n} artists`)}`, req.url), 303);
}
