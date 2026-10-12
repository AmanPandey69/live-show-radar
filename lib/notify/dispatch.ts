import { DateTime } from "luxon";
import type { Repo } from "@/lib/db/repo";
import type { Alert, Settings } from "@/lib/domain/types";
import type { RenderedAlert } from "@/lib/alerts/render";
import { IST } from "@/lib/text/dates-ist";
import { MockNotifier, type Notifier, type OutgoingMessage } from "./notifiers";

export function inQuietHours(s: Settings, now: Date): boolean {
  if (!s.quiet_hours.enabled) return false;
  const t = DateTime.fromJSDate(now).setZone(IST).toFormat("HH:mm");
  const { start, end } = s.quiet_hours;
  return start <= end ? t >= start && t < end : t >= start || t < end; // overnight window
}

export interface Channels { primary: Notifier[]; mock: MockNotifier }

/**
 * Deliver one alert. P0/P1 ignore quiet hours. Urgent alerts (P0 or urgency ≥ 70) go to every live channel;
 * others go to the first available channel with fallback to the next on failure. Every attempt is logged.
 * Demo alerts only reach real channels when explicitly allowed (admin "Simulate announcement"), labelled [DEMO].
 */
export async function deliver(
  repo: Repo,
  ch: Channels,
  alert: Alert,
  rendered: RenderedAlert,
  opts: { settings: Settings; now: Date; urgency: number; allowDemoSend?: boolean; icsUrl: string | null },
): Promise<"sent" | "held" | "mock" | "failed"> {
  if (alert.priority === "P2" && inQuietHours(opts.settings, opts.now)) {
    await repo.updateAlert(alert.id, { held_for_quiet: true });
    await repo.addDelivery({ alert_id: alert.id, channel: "inapp", status: "skipped", attempt: 1, error: "held for quiet hours", external_id: null, created_at: opts.now.toISOString() } as never);
    return "held";
  }
  const msg: OutgoingMessage = { alertId: alert.id, eventId: alert.event_id, rendered, buttons: true, icsUrl: opts.icsUrl };
  const live = ch.primary.filter((n) => n.available() && (n.channel !== "email" || opts.settings.channels.email));
  const demoBlocked = alert.is_demo && !opts.allowDemoSend;

  if (live.length === 0 || demoBlocked) {
    await ch.mock.send(msg);
    await repo.addDelivery({ alert_id: alert.id, channel: "mock", status: "mock", attempt: 1, error: demoBlocked ? "demo event: real channels disabled" : "no live channel configured", external_id: null } as never);
    await repo.updateAlert(alert.id, { sent_at: opts.now.toISOString() });
    return "mock";
  }

  const urgent = alert.priority === "P0" || opts.urgency >= 70;
  let anyOk = false;
  for (const n of live) {
    if (anyOk && !urgent) break; // non-urgent: first successful channel is enough
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      const r = await n.send(msg);
      ok = r.ok;
      await repo.addDelivery({ alert_id: alert.id, channel: n.channel === "mock" ? "mock" : n.channel, status: r.ok ? "sent" : "failed", attempt, error: r.error ?? null, external_id: r.external_id ?? null } as never);
    }
    anyOk ||= ok;
  }
  await repo.addDelivery({ alert_id: alert.id, channel: "inapp", status: "sent", attempt: 1, error: null, external_id: null } as never);
  if (anyOk) await repo.updateAlert(alert.id, { sent_at: new Date().toISOString() });
  return anyOk ? "sent" : "failed";
}
