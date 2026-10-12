import { NextResponse } from "next/server";
import { passwordMatches, setAdminCookie } from "@/lib/auth/admin";

export async function POST(req: Request) {
  const f = await req.formData();
  if (!passwordMatches(String(f.get("password") ?? ""))) return NextResponse.redirect(new URL("/settings?err=1", req.url), 303);
  await setAdminCookie();
  return NextResponse.redirect(new URL("/settings", req.url), 303);
}
