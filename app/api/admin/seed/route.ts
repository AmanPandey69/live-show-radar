import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { getRepo } from "@/lib/db";
import { makeEngine } from "@/lib/scheduler/lanes";
import { seedArtists, seedDemo, seedVenues } from "@/lib/seed";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const repo = getRepo();
  const a = await seedArtists(repo);
  await seedVenues(repo);
  const d = await seedDemo(await makeEngine(repo));
  return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`seeded ${a} artists, ${d} demo events`)}`, req.url), 303);
}
