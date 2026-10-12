import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/config/env";

const COOKIE = "lsr_admin";

function token(): string | null {
  const pw = env().ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac("sha256", pw).update("live-show-radar-admin-v1").digest("hex");
}

export function passwordMatches(input: string): boolean {
  const pw = env().ADMIN_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(createHmac("sha256", "cmp").update(input).digest("hex"));
  const b = Buffer.from(createHmac("sha256", "cmp").update(pw).digest("hex"));
  return timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const t = token();
  if (!t) return env().MOCK_MODE; // local mock mode without a password: admin allowed
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && c.length === t.length && timingSafeEqual(Buffer.from(c), Buffer.from(t));
}

export async function setAdminCookie() {
  const t = token();
  if (!t) return;
  (await cookies()).set(COOKIE, t, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
}

export async function clearAdminCookie() {
  (await cookies()).delete(COOKIE);
}

/** Cron / scheduler auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically). */
export function cronAuthorized(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return env().MOCK_MODE;
  const h = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return h.length === expected.length && timingSafeEqual(Buffer.from(h), Buffer.from(expected));
}
