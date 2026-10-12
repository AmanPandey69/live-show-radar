import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceChip, STATUS_CHIP } from "@/components/EventCard";
import { Countdown } from "@/components/Countdown";
import { googleCalendarUrl } from "@/lib/alerts/ics";
import { decisionCard, ticketStatusLine } from "@/lib/alerts/render";
import { isAdmin } from "@/lib/auth/admin";
import { env } from "@/lib/config/env";
import { getRepo } from "@/lib/db";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const e = await repo.getEvent(id);
  if (!e) notFound();
  const [tiers, sources, artists, alerts, reminders, feedback, admin] = await Promise.all([
    repo.listTiers([id]), repo.listEventSources([id]), repo.listArtists(), repo.listAlerts({ eventId: id, limit: 50 }), repo.listReminders(id), repo.listFeedback(id), isAdmin(),
  ]);
  const names = [...e.headliner_ids, ...e.support_ids].map((x) => artists.find((a) => a.id === x)?.name ?? "?");
  const others = (await repo.listEvents({})).filter((x) => x.id !== e.id && x.is_demo === e.is_demo && x.headliner_ids.some((h) => e.headliner_ids.includes(h)));
  const card = decisionCard({ event: e, tiers, homeCity: env().HOME_CITY, otherIndiaEvents: others.map((o) => ({ city: o.city, date: o.start_date_local })) }, new Date());
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const url = `${base}/event/${e.id}`;
  const watched = tiers.filter((t) => t.sale_start_at && Date.parse(t.sale_start_at) > Date.now());

  return (
    <div className="space-y-5">
      <div className={`panel p-5 ${e.confidence !== "confirmed" ? "unconfirmed" : ""}`}>
        <div className="flex flex-wrap gap-2 mb-2">
          {e.is_demo && <span className="chip chip-demo">SAMPLE · demo data</span>}
          <span className="chip">{e.priority}</span>
          <span className={`chip ${STATUS_CHIP[e.status] ?? ""}`}>{e.status.replace("_", " ")}</span>
          <ConfidenceChip c={e.confidence} />
          <span className="chip">urgency {e.urgency}/100</span>
        </div>
        <h1 className="text-2xl font-extrabold">{names.join(" + ")}</h1>
        <p className="muted">{e.title}</p>
        <div className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
          <div>📍 {e.venue_name_raw ?? "Venue not stated"}, <b>{e.city}</b></div>
          <div>📅 {e.start_at ? formatIst(e.start_at, { withYear: true }) : e.start_date_local ? `${formatIstDate(e.start_date_local)} (time not stated)` : "Date not stated"}{e.doors_at ? ` · doors ${formatIst(e.doors_at).split(", ")[1]}` : ""}</div>
        </div>
        <p className="mt-3 font-semibold text-[#ffc2d3]">🎟 {ticketStatusLine(tiers)}</p>
        <div className="flex flex-wrap gap-2 mt-4">
          {e.ticket_url && <a className="btn btn-primary" href={e.ticket_url} target="_blank" rel="noreferrer">Open tickets ↗</a>}
          <a className="btn" href={`/api/event/${e.id}/ics`}>Download .ics (with T-24h/1h/10m alarms)</a>
          <a className="btn" href={googleCalendarUrl(e, names.join(" + "), url, watched[0])} target="_blank" rel="noreferrer">Add to Google Calendar</a>
        </div>
        {e.confidence !== "confirmed" && <p className="text-sm mt-3 text-[var(--warn)]">⚠ Unconfirmed: only non-official / single-source evidence so far. Verify on the ticket link before paying.</p>}
      </div>

      {card.length > 0 && (
        <div className="panel p-5">
          <h2 className="font-bold mb-2">Travel decision card (from Bengaluru)</h2>
          <ul className="text-sm space-y-1">{card.map((l) => <li key={l}>• {l}</li>)}</ul>
          <p className="text-xs muted mt-2">Travel times are approximate and static; no fares are shown.</p>
        </div>
      )}

      <div className="panel p-5 overflow-x-auto">
        <h2 className="font-bold mb-2">Ticket tiers</h2>
        {tiers.length === 0 ? <p className="muted text-sm">No tier information stated by any source. Early-bird: not stated, check the link.</p> : (
          <table className="t">
            <thead><tr><th>Tier</th><th>Availability</th><th>Price (₹)</th><th>Sale window (IST)</th><th>Confidence</th><th>Evidence (quoted)</th></tr></thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name_raw}</b><div className="muted text-xs">{t.tier_type.replace("_", " ")}</div>{t.quantity_note && <div className="chip chip-warn mt-1">{t.quantity_note}</div>}</td>
                  <td>{t.availability}</td>
                  <td>{t.price_inr_min ? (t.price_inr_max && t.price_inr_max !== t.price_inr_min ? `${t.price_inr_min}–${t.price_inr_max}` : t.price_inr_min) : <span className="muted">not stated</span>}</td>
                  <td className="text-xs">
                    {t.sale_start_at ? <div>opens {formatIst(t.sale_start_at)}</div> : null}
                    {t.sale_end_at ? <div>closes {formatIst(t.sale_end_at)}</div> : null}
                    {!t.sale_start_at && !t.sale_end_at && <span className="muted">not stated</span>}
                    {t.sale_start_at && Date.parse(t.sale_start_at) > Date.now() && <div className="mt-1"><Countdown at={t.sale_start_at} label="opens in" /></div>}
                  </td>
                  <td><span className={`chip ${t.field_confidence === "confirmed" ? "chip-ok" : "chip-warn"}`}>{t.field_confidence}</span></td>
                  <td className="text-xs muted max-w-xs">“{t.evidence_snippet}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel p-5">
        <h2 className="font-bold mb-2">Sources & evidence ({sources.length})</h2>
        <ul className="space-y-3 text-sm">
          {sources.map((s) => (
            <li key={s.id}>
              <a className="underline break-all" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
              <span className="ml-2 chip">{s.source_id}{s.is_primary ? " · official" : ""}</span>
              <div className="muted text-xs mt-1">first seen {formatIst(s.first_seen_at)}{s.published_at ? ` · published ${formatIst(s.published_at)}` : ""}</div>
              <blockquote className="mt-1 text-xs border-l-2 border-[var(--border)] pl-2 muted">{s.snippet}</blockquote>
            </li>
          ))}
        </ul>
        {e.conflicts.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold text-[var(--warn)]">Conflicting values (kept, not applied)</h3>
            <ul className="text-xs muted">{e.conflicts.map((c, i) => <li key={i}>{c.field}: {c.values.map((v) => `${JSON.stringify(v.value)} (${v.source_url})`).join(" vs ")}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="panel p-5">
        <h2 className="font-bold mb-2">Feedback</h2>
        {admin ? (
          <form action="/api/feedback" method="post" className="flex flex-wrap gap-2">
            <input type="hidden" name="event_id" value={e.id} />
            {(["going", "maybe", "not_interested", "wrong_artist", "wrong_info"] as const).map((k) => (
              <button key={k} name="kind" value={k} className="btn">{k.replace("_", " ")}</button>
            ))}
          </form>
        ) : <p className="text-sm muted">Feedback buttons are available to the owner (Telegram or after <Link className="underline" href="/settings">admin login</Link>).</p>}
        {feedback.length > 0 && <p className="text-xs muted mt-2">Recorded: {feedback.map((f) => f.kind).join(", ")}</p>}
      </div>

      <div className="panel p-5 overflow-x-auto">
        <h2 className="font-bold mb-2">Alert history</h2>
        {alerts.length === 0 ? <p className="muted text-sm">No alerts yet.</p> : (
          <table className="t"><thead><tr><th>When</th><th>Type</th><th>Priority</th><th>Summary</th></tr></thead>
            <tbody>{alerts.map((a) => <tr key={a.id}><td className="text-xs">{formatIst(a.created_at)}</td><td>{a.type}</td><td>{a.priority}</td><td className="text-xs">{a.text.split("\n")[0]}</td></tr>)}</tbody></table>
        )}
        {reminders.length > 0 && <p className="text-xs muted mt-2">Reminders: {reminders.map((r) => `${r.offset_label} before ${r.kind.replace("_", " ")} (${formatIst(r.fire_at)}${r.sent_at ? ", sent" : ""})`).join(" · ")}</p>}
      </div>
    </div>
  );
}
