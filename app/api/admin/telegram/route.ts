import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { env, hasTelegram } from "@/lib/config/env";
import { telegramApi } from "@/lib/notify/notifiers";

/** Registers the Telegram webhook server-side (token never leaves the server). */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasTelegram()) return NextResponse.redirect(new URL("/settings?msg=Telegram%20env%20not%20set", req.url), 303);
  const r = await telegramApi("setWebhook", {
    url: `${env().APP_BASE_URL.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: env().TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  const test = await telegramApi("sendMessage", { chat_id: env().TELEGRAM_CHAT_ID, text: "Live Show Radar connected ✅ Forward me an Instagram post link, a poster screenshot or a ticket link to add a show." });
  return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent(`setWebhook: ${r.ok ? "ok" : r.description}; test message: ${test.ok ? "sent" : test.description}`)}`, req.url), 303);
}
