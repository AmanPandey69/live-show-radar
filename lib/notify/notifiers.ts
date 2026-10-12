import { env, hasEmail, hasTelegram } from "@/lib/config/env";
import type { RenderedAlert } from "@/lib/alerts/render";

export interface SendResult { ok: boolean; external_id?: string; error?: string }
export interface OutgoingMessage {
  alertId: string;
  eventId: string | null;
  rendered: RenderedAlert;
  buttons: boolean;
  icsUrl: string | null;
}

export interface Notifier {
  channel: "telegram" | "email" | "mock";
  available(): boolean;
  send(m: OutgoingMessage): Promise<SendResult>;
}

/** MOCK: records messages in memory (visible in tests and logs); never leaves the process. */
export class MockNotifier implements Notifier {
  channel = "mock" as const;
  sent: OutgoingMessage[] = [];
  available() { return true; }
  async send(m: OutgoingMessage) {
    this.sent.push(m);
    return { ok: true, external_id: `mock-${this.sent.length}` };
  }
}

export function telegramKeyboard(m: OutgoingMessage) {
  const id = m.alertId;
  const rows: { text: string; url?: string; callback_data?: string }[][] = [];
  const top: { text: string; url?: string; callback_data?: string }[] = [];
  if (m.rendered.ticketUrl) top.push({ text: "🎟 Open tickets", url: m.rendered.ticketUrl });
  top.push({ text: "Details", url: m.rendered.eventUrl });
  rows.push(top);
  rows.push([
    { text: "✅ Going", callback_data: `fb:going:${id}` },
    { text: "🤔 Maybe", callback_data: `fb:maybe:${id}` },
    { text: "🙅 Not interested", callback_data: `fb:not_interested:${id}` },
  ]);
  rows.push([
    { text: "❌ Wrong info", callback_data: `fb:wrong_info:${id}` },
    { text: "👤 Wrong artist", callback_data: `fb:wrong_artist:${id}` },
  ]);
  const cal: { text: string; url?: string; callback_data?: string }[] = [];
  if (m.icsUrl) cal.push({ text: "📅 Add to calendar", url: m.icsUrl });
  cal.push({ text: "⏰ Remind me before sale", callback_data: `rm:${id}` });
  rows.push(cal);
  return { inline_keyboard: rows };
}

export async function telegramApi(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${env().TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as { ok: boolean; result?: unknown; description?: string };
}

export class TelegramNotifier implements Notifier {
  channel = "telegram" as const;
  available() { return hasTelegram(); }
  async send(m: OutgoingMessage) {
    try {
      const r = await telegramApi("sendMessage", {
        chat_id: env().TELEGRAM_CHAT_ID,
        text: m.rendered.html.slice(0, 4000),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(m.buttons ? { reply_markup: telegramKeyboard(m) } : {}),
      });
      if (!r.ok) return { ok: false, error: r.description ?? "telegram error" };
      return { ok: true, external_id: String((r.result as { message_id?: number })?.message_id ?? "") };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class EmailNotifier implements Notifier {
  channel = "email" as const;
  available() { return hasEmail(); }
  async send(m: OutgoingMessage) {
    const r = m.rendered;
    const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5">
<p style="font-weight:700;${r.unconfirmed ? "color:#a15c00" : ""}">${escHtml(r.title)}</p>
${r.lines.map((l) => `<div>${l.startsWith("Tickets:") ? `<b>${escHtml(l)}</b>` : escHtml(l)}</div>`).join("\n")}
<p>${r.ticketUrl ? `<a href="${escHtml(r.ticketUrl)}">Open tickets</a> · ` : ""}<a href="${escHtml(r.eventUrl)}">Details &amp; evidence</a>${m.icsUrl ? ` · <a href="${escHtml(m.icsUrl)}">Add to calendar (.ics)</a>` : ""}</p></div>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env().RESEND_API_KEY}`, "content-type": "application/json", "Idempotency-Key": `alert-${m.alertId}` },
        body: JSON.stringify({ from: env().FROM_EMAIL, to: [env().ALERT_EMAIL], subject: r.title.slice(0, 180), html, text: r.text }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { id?: string; message?: string };
      return res.ok ? { ok: true, external_id: j.id } : { ok: false, error: j.message ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
