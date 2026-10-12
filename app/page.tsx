import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { HeroCarousel, type Slide } from "@/components/HeroCarousel";
import { PosterRing } from "@/components/PosterRing";
import { ShowTabs } from "@/components/ShowTabs";
import { ticketTone } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";
import { loadRadar, type EventView } from "@/lib/view";

export const dynamic = "force-dynamic";

const nameOf = (v: EventView) => v.artists.join(" + ") || v.event.title;
const shortDate = (v: EventView) => (v.event.start_date_local ? formatIstDate(v.event.start_date_local).replace(/ \d{4}$/, "") : "Date TBA");

export default async function RadarPage() {
  const { views, artists } = await loadRadar({});
  const hb = await getRepo().getKv<{ at: string; lane: string }>("heartbeat");
  const real = views.filter((v) => !v.event.is_demo);

  // Hero: real shows with artwork first, hot ones first.
  const heroPool = [...real].sort((a, b) => Number(!!b.event.image_url) - Number(!!a.event.image_url) || Number(ticketTone(b.statusLine) === "hot") - Number(ticketTone(a.statusLine) === "hot") || b.event.urgency - a.event.urgency).slice(0, 6);
  const slides: Slide[] = heroPool.map((v) => ({
    id: v.event.id, image: v.event.image_url, artist: nameOf(v), city: v.event.city, venue: v.event.venue_name_raw ?? "Venue TBA",
    when: v.event.start_at ? formatIst(v.event.start_at) : v.event.start_date_local ? formatIstDate(v.event.start_date_local) : "Date TBA",
    status: v.statusLine, hot: ticketTone(v.statusLine) === "hot", sample: v.event.is_demo,
    target: v.countdown?.at ?? v.event.start_at ?? (v.event.start_date_local ? `${v.event.start_date_local}T13:30:00Z` : null),
    targetLabel: v.countdown ? v.countdown.label.replace(" in", "") + " in" : "Show starts in",
  }));
  const ring = [...views].sort((a, b) => Number(!!b.event.image_url) - Number(!!a.event.image_url)).slice(0, 10)
    .map((v) => ({ id: v.event.id, image: v.event.image_url, artist: nameOf(v), city: v.event.city, date: shortDate(v) }));
  const marquee = real.map((v) => `${nameOf(v)} · ${v.event.city} · ${shortDate(v)}`);
  // Lightweight props for the client-side tabs (drop evidence snippets etc.).
  const slim: EventView[] = views.map((v) => ({ ...v, tiers: [], sources: v.sources.map((s) => ({ ...s, snippet: "" })) }));

  return (
    <div className="space-y-12">
      <HeroCarousel
        slides={slides}
        stats={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
            <MiniStat v={real.length} l="Upcoming India shows" />
            <MiniStat v={real.filter((x) => x.isHome).length} l="In Bengaluru" />
            <MiniStat v={real.filter((x) => ticketTone(x.statusLine) === "hot").length} l="Early-bird open now" />
            <MiniStat v={artists.length} l="Artists watched" />
          </div>
        }
      />

      {marquee.length > 0 && (
        <div className="marquee -mt-4 py-3 border-y border-white/10">
          {[0, 1].map((k) => (
            <div key={k} className="marquee-track" aria-hidden={k === 1}>
              {marquee.map((m, i) => (
                <span key={`${k}-${i}`} className="display text-base sm:text-lg font-bold whitespace-nowrap flex items-center gap-10">
                  <span className={i % 2 ? "text-white/85" : "grad-text"}>{m}</span><span className="text-[#c084fc]">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      <ShowTabs views={slim} />

      {/* Ring + CTA side by side (one screen, not two) */}
      <section className="relative overflow-hidden rounded-[32px] border border-white/10 grid lg:grid-cols-[1fr_1.1fr] items-center" style={{ background: "radial-gradient(600px 300px at 20% 0%, rgba(236,72,153,.3), transparent 70%), linear-gradient(135deg, #2e1065, #4c1d95 45%, #1e1b4b)" }}>
        <div className="p-8 sm:p-12 relative z-10">
          <div className="text-[11px] font-semibold tracking-[.18em] uppercase text-[#f0abfc] mb-3">Always on the radar</div>
          <h2 className="text-4xl sm:text-5xl font-extrabold leading-[1]">Get tickets <span className="grad-text">first.</span></h2>
          <p className="text-white/75 mt-4 max-w-md">One email the minute a show or early-bird drops, with the venue, the IST time and the ticket link. Every fact is quoted from its source.</p>
          <div className="flex flex-wrap gap-3 mt-7">
            <Link href="/alerts" className="btn btn-primary">See past alerts</Link>
            <Link href="/health" className="btn">What we checked</Link>
          </div>
          {hb && <div className="text-xs text-white/50 mt-5"><span className="radar-dot mr-2" />Last scan {formatIst(hb.at)}</div>}
        </div>
        <div className="-my-6 lg:my-0"><PosterRing items={ring} /></div>
      </section>
    </div>
  );
}

function MiniStat({ v, l }: { v: number; l: string }) {
  return (
    <div className="stat !py-3.5">
      <div className="v !text-[32px]"><CountUp to={v} /></div>
      <div className="l">{l}</div>
    </div>
  );
}
