import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRepo } from "@/lib/db";
import { exchangeCode, syncSpotify } from "@/lib/spotify/spotify";

export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const jar = await cookies();
  const [state, verifier] = (jar.get("sp_pkce")?.value ?? ".").split(".");
  jar.delete("sp_pkce");
  if (!u.searchParams.get("code") || !state || u.searchParams.get("state") !== state) {
    return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`Spotify: ${u.searchParams.get("error") ?? "state mismatch"}`)}`, req.url));
  }
  const repo = getRepo();
  try {
    await exchangeCode(repo, u.searchParams.get("code")!, verifier);
    const r = await syncSpotify(repo);
    return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`Spotify connected: ${r?.followed ?? 0} followed, ${r?.top ?? 0} top artists synced`)}`, req.url));
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`Spotify error: ${(e as Error).message}`)}`, req.url));
  }
}
