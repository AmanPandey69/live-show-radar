import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { hasSpotify } from "@/lib/config/env";
import { authorizeUrl, pkcePair } from "@/lib/spotify/spotify";

/** Owner-only Spotify connect (Authorization Code + PKCE). Visitors never need Spotify. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/settings", req.url));
  if (!hasSpotify()) return NextResponse.redirect(new URL("/settings?msg=Spotify%20env%20not%20set", req.url));
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("sp_pkce", `${state}.${verifier}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(challenge, state));
}
