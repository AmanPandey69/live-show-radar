import { NextResponse } from "next/server";
import { clearAdminCookie } from "@/lib/auth/admin";

export async function POST(req: Request) {
  await clearAdminCookie();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
