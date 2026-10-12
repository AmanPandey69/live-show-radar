import Link from "next/link";
import { DateTime } from "luxon";
import { EventCard } from "@/components/EventCard";
import { SignalBars } from "@/components/SignalBars";
import { Empty, SectionTitle, ticketTone } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";
import { fmtMins, latencyStats, loadRadar } from "@/lib/view";

export const dynamic = "force-dynamic";

function chipHref(sp: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ city?: string; artist?: string; demo?: string }> }) {
  const sp = await searchParams;
  const { views, cities, artistNames, artists } = await loadRadar({ city: sp.city, artist: sp.artist });
  const repo = getRepo();
  const [hb, health, alerts] = await Promise.all([repo.getKv<{ at: string; lane: string }>("heartbeat"), repo.listHealth(), repo.listAlerts({ limit: 300 })]);
  const showDemo = sp.demo !== "0";
  const list = views.filter((v) => showDemo || !v.event.is_demo);
  const real = views.filter((v) => !v.event.is_demo);
  const hot = list.filter((v) => ["hot", "soon"].includes(ticketTone(v.statusLine)));
  const home = list.filter((v) => v.isHome);
  const rest = list.filter((v) => !v.isHome);
  const okSources = health.filter((h) => h.status === "ok").length;
  const lat = latencyStats(alerts);
  const top = [...list].sort((a, b) => b.event.urgency - a.event.urgency).slice(0, 5);
  const today = DateTime.now().setZone("Asia/Kolkata").toFormat("cccc, d LLLL");
  const hotCount = real.filter((v) => ticketTone(v.statusLine) === "hot").length;

  return (
    <div className="space-y-14">
      {/* Greeting */}
      <section>
        <div className="mono text-[11px] tracking-[.16em] uppercase muted mb-4">{today}</div>
        <h1 className="text-[56px] sm:text-[76px] leading-[.95]">Hello, <i className="text-[var(--accent)]">Karan.</i></h1>
        <p className="muted text-[16px] mt-3 max-w-2xl">
          {hotCount > 0
            ? `${hotCount} show${hotCount > 1 ? "s have" : " has"} early-bird tickets open right now. These usually sell out within about 6 hours.`
            : `${real.length} upcoming India shows from the artists you follow. Nothing needs you this minute.`}
        </p>
        <div className="flex flex-wrap gap-2 mt-6">
          <Link href="#bengaluru" className="btn">Bengaluru</Link>
          <Link href="/alerts" className="btn">Alert history</Link>
          <Link href="/health" className="btn">↻ What we checked</Link>
          <Link href="/artists" className="btn">{artists.length} artists</Link>
        </div>
      </section>

      {/* Radar log: highest-urgency shows, waveform meter = urgency */}
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <div className="mono text-[11px] tracking-[.14em] uppercase flex items-center gap-2"><span className="radar-dot" /> Radar log</div>
          <div className="mono text-[11px] tracking-[.14em] uppercase muted">by urgency</div>
        </div>
        {top.length === 0 && <div className="p-6 muted text-sm">No shows yet. The next scan will fill this in.</div>}
        {top.map((v) => (
          <Link key={v.event.id} href={`/event/${v.event.id}`} className="block px-5 py-4 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--paper)] transition">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold truncate">{v.artists.join(" + ") || v.event.title}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${ticketTone(v.statusLine) === "hot" ? "bg-[var(--accent)]" : v.event.confidence === "confirmed" ? "bg-[var(--ok)]" : "bg-[#d99a00]"}`} />
                <span className="text-sm muted truncate">{v.event.confidence}{v.event.is_demo ? " · sample" : ""}</span>
              </div>
              <span className="text-sm muted shrink-0">{v.event.start_date_local ? formatIstDate(v.event.start_date_local) : "date TBA"}</span>
            </div>
            <div className="my-2.5"><SignalBars value={v.event.urgency} hot={ticketTone(v.statusLine) === "hot"} /></div>
            <div className="flex justify-between gap-3 mono text-[10.5px] tracking-[.08em] uppercase muted">
              <span className="truncate">{v.statusLine}</span>
              <span className="shrink-0">{v.event.city}</span>
            </div>
          </Link>
        ))}
      </section>

      {/* Radar pulse */}
      <section className="rounded-[22px] bg-[var(--ink)] text-[#f4f0e8] overflow-hidden">
        <div className="px-6 py-4 flex items-baseline gap-3 border-b border-white/10">
          <span className="serif text-2xl">Radar pulse</span>
          <span className="mono text-[10.5px] tracking-[.14em] uppercase text-white/50">live</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            ["Upcoming shows", String(real.length)],
            ["In Bengaluru", String(real.filter((v) => v.isHome).length)],
            ["Median time to alert", fmtMins(lat.median)],
            ["Sources healthy", `${okSources}/${health.length || okSources}`],
          ].map(([l, v], i) => (
            <div key={l} className={`px-6 py-5 ${i % 2 === 1 ? "border-l border-white/10" : ""} ${i >= 2 ? "border-t md:border-t-0 border-white/10" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <div className="mono text-[10.5px] tracking-[.12em] uppercase text-white/50">{l}</div>
              <div className="serif text-[44px] leading-none mt-2">{v}</div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 border-t border-white/10 mono text-[10.5px] tracking-[.1em] uppercase text-white/45">
          {hb ? `Last scan ${formatIst(hb.at)} · ${hb.lane} lane` : "No scan yet"} · {artists.length} artists watched
        </div>
      </section>

      {/* Filters */}
      <section className="space-y-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Link href={chipHref(sp, { city: undefined })} className={`filter-chip ${!sp.city ? "active" : ""}`}>All cities</Link>
          {cities.map((c) => <Link key={c} href={chipHref(sp, { city: c })} className={`filter-chip ${sp.city === c ? "active" : ""}`}>{c}</Link>)}
        </div>
        <form className="flex flex-wrap gap-2 items-center" action="/">
          {sp.city && <input type="hidden" name="city" value={sp.city} />}
          <select name="artist" defaultValue={sp.artist ?? ""}>
            <option value="">All artists</option>
            {artistNames.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select name="demo" defaultValue={showDemo ? "1" : "0"}>
            <option value="1">Include sample data</option>
            <option value="0">Real shows only</option>
          </select>
          <button className="btn btn-primary">Apply</button>
          {(sp.city || sp.artist || sp.demo) && <Link className="text-sm muted underline underline-offset-4" href="/">Reset</Link>}
          <span className="mono text-[10px] tracking-[.08em] uppercase dim ml-auto hidden md:block">Dashed border = unconfirmed · Sample = demo, never alerts</span>
        </form>
      </section>

      {hot.length > 0 && (
        <section>
          <SectionTitle label="Act now" title={<>Early-birds <i>open or opening</i></>} count={hot.length} sub="sell out in ~6 hours" />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{hot.map((v) => <EventCard key={`hot-${v.event.id}`} v={v} />)}</div>
        </section>
      )}

      <section id="bengaluru">
        <SectionTitle label="Home city · top priority" title="Bengaluru" count={home.length} sub="shows" />
        {home.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{home.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <Empty title="Nothing in Bengaluru right now.">Silence means checked, not broken. See <Link className="underline" href="/health">Health</Link>.</Empty>
        )}
      </section>

      <section>
        <SectionTitle label="Worth the trip?" title={<>Rest of <i>India</i></>} count={rest.length} sub="with travel cards" />
        {rest.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{rest.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <Empty title="No other India shows found yet." />
        )}
      </section>
    </div>
  );
}
