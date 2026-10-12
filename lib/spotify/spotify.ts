import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";
import type { Repo } from "@/lib/db/repo";
import type { Affinity } from "@/lib/domain/types";

/** AES-256-GCM with a key derived from TOKEN_ENCRYPTION_KEY. Stored format: iv.tag.ciphertext (base64url). */
function key() {
  const k = env().TOKEN_ENCRYPTION_KEY;
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return createHash("sha256").update(k).digest();
}
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(s: string) {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(challenge: string, state: string) {
  const p = new URLSearchParams({
    client_id: env().SPOTIFY_CLIENT_ID!, response_type: "code", redirect_uri: env().SPOTIFY_REDIRECT_URI!,
    code_challenge_method: "S256", code_challenge: challenge, state, scope: "user-follow-read user-top-read",
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env().SPOTIFY_CLIENT_ID!, ...body }).toString(),
  });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`spotify token: ${j.error ?? res.status}`);
  return j;
}

export async function exchangeCode(repo: Repo, code: string, verifier: string) {
  const j = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env().SPOTIFY_REDIRECT_URI!, code_verifier: verifier });
  await repo.setSpotifyTokens({ access_enc: encrypt(j.access_token!), refresh_enc: encrypt(j.refresh_token!), expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(), scope: j.scope ?? null });
}

async function accessToken(repo: Repo): Promise<string | null> {
  const t = await repo.getSpotifyTokens();
  if (!t) return null;
  if (Date.parse(t.expires_at) - Date.now() > 60_000) return decrypt(t.access_enc);
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(t.refresh_enc) });
  await repo.setSpotifyTokens({
    access_enc: encrypt(j.access_token!), refresh_enc: j.refresh_token ? encrypt(j.refresh_token) : t.refresh_enc,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(), scope: j.scope ?? t.scope,
  });
  return j.access_token!;
}

type SpArtist = { id: string; name: string; genres?: string[] };

/** Followed artists (cursor pagination) + top artists → affinity. Never depends on popularity/followers. */
export async function syncSpotify(repo: Repo): Promise<{ followed: number; top: number } | null> {
  const token = await accessToken(repo);
  if (!token) return null;
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`spotify ${r.status} ${url.split("?")[0]}`);
    return r.json();
  };
  const followed: SpArtist[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/following?type=artist&limit=50";
  while (url) {
    const j = (await get(url)) as { artists: { items: SpArtist[]; next: string | null } };
    followed.push(...j.artists.items);
    url = j.artists.next;
  }
  let top: SpArtist[] = [];
  try {
    top = ((await get("https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term")) as { items: SpArtist[] }).items;
  } catch {
    top = [];
  }
  const rank = new Map(top.map((a, i) => [a.id, i + 1]));
  for (const a of followed) {
    const r = rank.get(a.id) ?? null;
    const affinity: Affinity = r !== null && r <= 15 ? "must_see" : r !== null ? "like" : "like";
    const row = await repo.upsertArtist({ name: a.name, spotify_id: a.id, genres: a.genres ?? [], top_rank: r, is_followed: true, affinity, origin: "spotify" });
    await repo.addAlias(row.id, a.name, "canonical");
    if (/^the /i.test(a.name)) await repo.addAlias(row.id, a.name.replace(/^the /i, ""), "the_prefix");
  }
  return { followed: followed.length, top: top.length };
}
