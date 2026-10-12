import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await req.formData();
  const repo = getRepo();
  await repo.setSettings({
    quiet_hours: { enabled: f.get("quiet_enabled") === "on", start: String(f.get("quiet_start") || "23:00"), end: String(f.get("quiet_end") || "07:30") },
    channels: { telegram: f.get("ch_telegram") === "on", email: f.get("ch_email") === "on" },
    whispers_enabled: f.get("whispers") === "on",
    coverage_hours: { must_see: Number(f.get("cov_must") || 3), default: Number(f.get("cov_default") || 12) },
  });
  return NextResponse.redirect(new URL("/settings?msg=saved", req.url), 303);
}
