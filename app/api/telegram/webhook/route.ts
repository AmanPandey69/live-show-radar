import { after, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { scheduleReminders } from "@/lib/alerts/reminders";
import { env } from "@/lib/config/env";
import { getRepo } from "@/lib/db";
import type { ObservationInput } from "@/lib/domain/schemas";
import { isPrimaryUrl } from "@/lib/domain/rules";
import type { FeedbackKind } from "@/lib/domain/types";
import { applyFeedback } from "@/lib/feedback";
import { telegramApi } from "@/lib/notify/notifiers";
import { makeEngine } from "@/lib/scheduler/lanes";
import { obs } from "@/lib/sources/adapters/common";
import { PoliteHttp } from "@/lib/sources/http";
import { extractJsonLd, isEvent, jsonLdToCandidate } from "@/lib/sources/parse/jsonld";
import { htmlToText, sha256 } from "@/lib/text/normalize";

export const maxDuration = 60;

type Update = {
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
  message?: { chat: { id: number }; text?: string; caption?: string; photo?: { file_id: string; width: number }[]; document?: { file_id: string; mime_type?: string } };
};

const LOGIN_WALLED = /instagram\.com|facebook\.com|fb\.watch|threads\.net|x\.com|twitter\.com/i;

function authorized(req: Request) {
  const s = env().TELEGRAM_WEBHOOK_SECRET ?? "";
  const h = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return !!s && h.length === s.length && timingSafeEqual(Buffer.from(h), Buffer.from(s));
}

const reply = (text: string) => telegramApi("sendMessage", { chat_id: env().TELEGRAM_CHAT_ID, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });

/** Share-to-Radar: forwarded links, posters/screenshots and text → the same pipeline, with an instant alert. */
async function handleShare(m: NonNullable<Update["message"]>) {
  const repo = getRepo();
  const engine = await makeEngine(repo);
  const now = new Date();
  const text = (m.text ?? m.caption ?? "").trim();
  const url = /(https?:\/\/\S+)/.exec(text)?.[1] ?? null;
  let o: ObservationInput | null = null;

  const photoId = m.photo?.length ? m.photo[m.photo.length - 1].file_id : m.document?.mime_type?.startsWith("image/") ? m.document.file_id : null;
  if (photoId) {
    const f = await telegramApi("getFile", { file_id: photoId });
    const path = (f.result as { file_path?: string } | undefined)?.file_path;
    if (!path) return reply("Couldn't download that image.");
    const res = await fetch(`https://api.telegram.org/file/bot${env().TELEGRAM_BOT_TOKEN}/${path}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
    o = { ...obs({ source_id: "telegram-share", url: url ?? `telegram:photo:${sha256(buf.toString("base64")).slice(0, 16)}`, text: text || "(poster image)", title: "Shared poster", is_primary: false, now, hashExtra: sha256(buf.toString("base64")) }), image: { mimeType: mime, base64: buf.toString("base64") } };
  } else if (url && LOGIN_WALLED.test(url)) {
    const rest = text.replace(url, "").trim();
    if (rest.length < 20) return reply("I don't open Instagram/login-walled pages. Please send a <b>screenshot</b> of the post (or paste its caption) and I'll read it.");
    o = obs({ source_id: "telegram-share", url, text: rest, title: rest.split("\n")[0], is_primary: false, now });
  } else if (url) {
    try {
      const page = await new PoliteHttp(repo).get(url, { minIntervalMs: 0 });
      const ev = extractJsonLd(page.body).find(isEvent);
      const cand = ev ? jsonLdToCandidate(ev, url, now) : null;
      const body = cand ? JSON.stringify(ev) : htmlToText(page.body).slice(0, 12000);
      o = obs({ source_id: "telegram-share", url, text: `${text}\n${body}`, title: cand?.title ?? text.slice(0, 120), candidate: cand, is_primary: isPrimaryUrl(url), now });
    } catch (e) {
      return reply(`Couldn't fetch that link politely (${(e as Error).message.slice(0, 120)}). Send a screenshot instead.`);
    }
  } else if (text.length > 15) {
    o = obs({ source_id: "telegram-share", url: `telegram:text:${sha256(text).slice(0, 16)}`, text, title: text.split("\n")[0], is_primary: false, now });
  } else {
    return reply("Send me an event link, a poster screenshot, or paste the announcement text.");
  }

  const r = await engine.ingest(o, { allowDemoSend: false });
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  if (r.status === "merged") return reply(`Added to Radar ✅ ${r.events.map((e) => `${base}/event/${e.id}${e.isNew ? " (new)" : " (updated)"}`).join("\n")}`);
  if (r.status === "unchanged") return reply("Already on the Radar (nothing new in that share).");
  return reply(`Not added: ${r.reason ?? r.status}. (Only shows in India for artists you follow are tracked; tribute/cover nights are ignored.)`);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const u = (await req.json()) as Update;
  const owner = String(env().TELEGRAM_CHAT_ID ?? "");

  if (u.callback_query) {
    const q = u.callback_query;
    if (String(q.message?.chat.id ?? "") !== owner) return NextResponse.json({ ok: true });
    const repo = getRepo();
    const [kind, a, b] = (q.data ?? "").split(":");
    const alertId = kind === "fb" ? b : a;
    const alert = (await repo.listAlerts({ limit: 500 })).find((x) => x.id === alertId);
    let text = "Saved";
    if (alert?.event_id && kind === "fb") text = await applyFeedback(repo, { event_id: alert.event_id, alert_id: alert.id, kind: a as FeedbackKind, channel: "telegram" });
    if (alert?.event_id && kind === "rm") {
      const e = await repo.getEvent(alert.event_id);
      if (e) {
        const n = await scheduleReminders(repo, e, await repo.listTiers([e.id]), new Date(), { includeGeneral: true });
        text = n ? `${n} reminder(s) set (T-24h / T-1h / T-10m)` : "No known sale time yet; I'll alert when one is announced";
      }
    }
    await telegramApi("answerCallbackQuery", { callback_query_id: q.id, text });
    return NextResponse.json({ ok: true });
  }

  if (u.message && String(u.message.chat.id) === owner) {
    const m = u.message;
    after(async () => {
      try { await handleShare(m); } catch (e) { await reply(`Share failed: ${(e as Error).message.slice(0, 150)}`); }
    });
  }
  return NextResponse.json({ ok: true });
}
