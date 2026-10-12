import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceChip, StatusChip } from "@/components/EventCard";
import { Countdown } from "@/components/Countdown";
import { Poster } from "@/components/Poster";
import { SignalBars } from "@/components/SignalBars";
import { DateBlock, TicketLine, ticketTone } from "@/components/ui";
import { googleCalendarUrl } from "@/lib/alerts/ics";
import { decisionCard, ticketStatusLine } from "@/lib/alerts/render";
import { isAdmin } from "@/lib/auth/admin";
import { env } from "@/lib/config/env";
import { getRepo } from "@/lib/db";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";

export const dynamic = "force-dynamic";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

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
  const line = ticketStatusLine(tiers);
  const when = e.start_at ? formatIst(e.start_at, { withYear: true }) : e.start_date_local ? `${formatIstDate(e.start_date_local)} · time not stated` : "Date not stated";

  return (
    <div className="space-y-8">
      <Link href="/" className="mono text-[11px] tracking-[.14em] uppercase muted hover:text-[var(--text)]">← Back to radar</Link>

      {/* Header */}
      <section className={`panel relative overflow-hidden p-6 sm:p-8 ${e.confidence !== "confirmed" ? "unconfirmed" : ""}`}>
        <div className="absolute inset-0 -z-0 opacity-45">
          <Poster src={e.image_url} name={names.join(" + ")} className="w-full h-full object-cover blur-[2px] scale-105" fontSize={120} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#07040f] via-[#07040f]/85 to-[#2e1065]/40" />
        <div className="relative">
        <div className="flex flex-wrap gap-1.5 mb-5">
          {e.is_demo && <span className="chip chip-demo">Sample · demo data</span>}
          <span className="chip chip-dark">{e.priority}</span>
          <StatusChip s={e.status} />
          <ConfidenceChip c={e.confidence} />
          {e.is_festival && <span className="chip">Festival</span>}
        </div>
        <div className="flex gap-5 items-start">
          <div className="scale-110 origin-top-left hidden sm:block"><DateBlock date={e.start_date_local} iso={e.start_at} /></div>
          <div className="min-w-0">
            <h1 className="text-5xl sm:text-7xl font-extrabold leading-[.92]">{names.join(" + ")}</h1>
            <p className="muted mt-3">{e.title}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-7 pt-6 border-t border-[var(--border)]">
          <Info label="Venue" value={e.venue_name_raw ?? "Not stated"} />
          <Info label="City" value={e.city} />
          <Info label="When (IST)" value={`${when}${e.doors_at ? ` · doors ${formatIst(e.doors_at).split(", ")[1]}` : ""}`} />
        </div>
        <div className="mt-6"><TicketLine line={line} /></div>
        <div className="flex flex-wrap gap-2 mt-5">
          {e.ticket_url && <a className="btn btn-primary" href={e.ticket_url} target="_blank" rel="noreferrer">Open tickets ↗</a>}
          <a className="btn" href={`/api/event/${e.id}/ics`}>Download .ics · 24h / 1h / 10m alarms</a>
          <a className="btn" href={googleCalendarUrl(e, names.join(" + "), url, watched[0])} target="_blank" rel="noreferrer">Google Calendar</a>
          {watched[0] && <Countdown at={watched[0].sale_start_at!} label="Sale opens in" />}
        </div>
        {e.confidence !== "confirmed" && <p className="text-sm mt-5 text-[var(--warn)]">Unconfirmed: evidence so far is from a single non-official source. Check the ticket link before paying.</p>}
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 items-start">
        <div className="space-y-6">
          {/* Tiers */}
          <section className="panel overflow-hidden">
            <PanelHead title="Ticket tiers" right="every value quoted" />
            {tiers.length === 0 ? <p className="muted text-sm p-5">No source states any tier. Early-bird: not stated, check the link.</p> : (
              <div className="divide-y divide-[var(--border)]">
                {tiers.map((t) => (
                  <div key={t.id} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{t.name_raw}</span>
                        <span className="chip">{t.tier_type.replace("_", " ")}</span>
                        {t.quantity_note && <span className="chip chip-warn">{t.quantity_note}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`chip ${t.availability === "open" ? "chip-ok" : t.availability === "upcoming" ? "chip-warn" : t.availability === "sold_out" || t.availability === "closed" ? "chip-bad" : ""}`}>{t.availability.replace("_", " ")}</span>
                        <span className={`chip ${t.field_confidence === "confirmed" ? "chip-ok" : "chip-warn"}`}>{t.field_confidence}</span>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm">
                      <Info label="Price" value={t.price_inr_min ? `₹${t.price_inr_min.toLocaleString("en-IN")}${t.price_inr_max && t.price_inr_max !== t.price_inr_min ? `–${t.price_inr_max.toLocaleString("en-IN")}` : ""}` : "Not stated"} />
                      <Info label="Sale opens" value={t.sale_start_at ? formatIst(t.sale_start_at) : "Not stated"} />
                      <Info label="Sale closes" value={t.sale_end_at ? formatIst(t.sale_end_at) : "Not stated"} />
                    </div>
                    <blockquote className="italic text-[14px] mt-3 pl-3 border-l-2 border-[var(--accent)] text-[var(--muted)]">“{t.evidence_snippet}”</blockquote>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Sources */}
          <section className="panel overflow-hidden">
            <PanelHead title={`Sources & evidence · ${sources.length}`} right={e.confidence} />
            <div className="divide-y divide-[var(--border)]">
              {sources.map((s) => (
                <div key={s.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-semibold underline underline-offset-4 decoration-[var(--border-2)] hover:decoration-[var(--ink)]" href={s.url} target="_blank" rel="noreferrer">{host(s.url)}</a>
                    <span className="chip">{s.source_id}</span>
                    {s.is_primary && <span className="chip chip-ok">official</span>}
                  </div>
                  <div className="mono text-[10.5px] tracking-[.06em] uppercase dim mt-1.5">First seen {formatIst(s.first_seen_at)}{s.published_at ? ` · published ${formatIst(s.published_at)}` : ""}</div>
                  <p className="text-sm muted mt-2 line-clamp-3">{s.snippet}</p>
                </div>
              ))}
            </div>
            {e.conflicts.length > 0 && (
              <div className="p-5 border-t border-[var(--border)] bg-[var(--warn-soft)]">
                <div className="mono text-[10.5px] tracking-[.12em] uppercase text-[var(--warn)] mb-1">Conflicting values (kept, not applied)</div>
                <ul className="text-sm">{e.conflicts.map((c, i) => <li key={i}>{c.field}: {c.values.map((v) => `${JSON.stringify(v.value)} (${v.source_url})`).join(" vs ")}</li>)}</ul>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[22px] p-6 border border-white/10" style={{ background: "linear-gradient(135deg, #4c1d95, #831843)" }}>
            <div className="mono text-[10.5px] tracking-[.14em] uppercase text-white/50">Urgency</div>
            <div className="display font-extrabold text-6xl leading-none mt-2">{e.urgency}<span className="text-2xl text-white/40">/100</span></div>
            <div className="mt-4 [&_span]:!bg-white/80"><SignalBars value={e.urgency} hot={ticketTone(line) === "hot"} n={26} /></div>
            <p className="text-sm text-white/60 mt-4">Combines your affinity, Bengaluru-first, venue size (approx.), early-bird state and how fresh the announcement is. It decides the channel and the reminders.</p>
          </section>

          {card.length > 0 && (
            <section className="panel p-6">
              <div className="mono text-[10.5px] tracking-[.14em] uppercase text-[var(--accent)]">Decision card</div>
              <h3 className="display font-extrabold text-3xl mt-1">Worth the trip?</h3>
              <ul className="mt-3 space-y-2 text-sm">{card.map((l) => <li key={l} className="flex gap-2"><span className="text-[var(--accent)]">→</span><span>{l}</span></li>)}</ul>
              <p className="mono text-[10px] tracking-[.06em] uppercase dim mt-4">Approximate static travel table · no fares</p>
            </section>
          )}

          <section className="panel p-6">
            <div className="mono text-[10.5px] tracking-[.14em] uppercase muted mb-3">Feedback</div>
            {admin ? (
              <form action="/api/feedback" method="post" className="flex flex-wrap gap-2">
                <input type="hidden" name="event_id" value={e.id} />
                {(["going", "maybe", "not_interested", "wrong_artist", "wrong_info"] as const).map((k) => (
                  <button key={k} name="kind" value={k} className="btn !py-1.5 !px-3 !text-[12.5px]">{k.replace("_", " ")}</button>
                ))}
              </form>
            ) : <p className="text-sm muted">Owner feedback after <Link className="underline" href="/settings">signing in</Link>.</p>}
            {feedback.length > 0 && <p className="text-xs muted mt-3">Recorded: {feedback.map((f) => f.kind.replace("_", " ")).join(", ")}</p>}
          </section>

          <section className="panel overflow-hidden">
            <PanelHead title="Alerts & reminders" right={String(alerts.length)} />
            {alerts.length === 0 && reminders.length === 0 && <p className="muted text-sm p-5">No alerts yet.</p>}
            <div className="divide-y divide-[var(--border)]">
              {alerts.map((a) => (
                <div key={a.id} className="px-5 py-3 text-sm flex justify-between gap-3">
                  <span><span className="chip mr-2">{a.type.replace(/_/g, " ")}</span>{a.priority}</span>
                  <span className="dim text-xs">{formatIst(a.created_at)}</span>
                </div>
              ))}
              {reminders.map((r) => (
                <div key={r.id} className="px-5 py-3 text-sm flex justify-between gap-3">
                  <span>⏰ {r.offset_label} before {r.kind.replace("_", " ")}</span>
                  <span className="dim text-xs">{formatIst(r.fire_at)}{r.sent_at ? " · sent" : ""}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[.12em] uppercase dim">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function PanelHead({ title, right }: { title: string; right?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
      <div className="mono text-[11px] tracking-[.14em] uppercase">{title}</div>
      {right && <div className="mono text-[11px] tracking-[.14em] uppercase muted">{right}</div>}
    </div>
  );
}
