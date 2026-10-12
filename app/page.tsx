import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { EventCard, TallCard } from "@/components/EventCard";
import { HeroCarousel, type Slide } from "@/components/HeroCarousel";
import { Poster } from "@/components/Poster";
import { PosterRing } from "@/components/PosterRing";
import { TallCarousel } from "@/components/TallCarousel";
import { Empty, SectionTitle, ticketTone } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";
import { loadRadar, type EventView } from "@/lib/view";

export const dynamic = "force-dynamic";

function chipHref(sp: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/?${s}#shows` : "/#shows";
}

const nameOf = (v: EventView) => v.artists.join(" + ") || v.event.title;
const shortDate = (v: EventView) => (v.event.start_date_local ? formatIstDate(v.event.start_date_local).replace(/ \d{4}$/, "") : "Date TBA");

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ city?: string; artist?: string; demo?: string }> }) {
  const sp = await searchParams;
  const all = await loadRadar({});
  const filtered = sp.city || sp.artist ? await loadRadar({ city: sp.city, artist: sp.artist }) : all;
  const { cities, artistNames, artists } = all;
  const hb = await getRepo().getKv<{ at: string; lane: string }>("heartbeat");
  const showDemo = sp.demo !== "0";
  const views = all.views;
  const real = views.filter((v) => !v.event.is_demo);
  const list = filtered.views.filter((v) => showDemo || !v.event.is_demo);
  const hot = views.filter((v) => ["hot", "soon"].includes(ticketTone(v.statusLine)) && (showDemo || !v.event.is_demo));
  const home = list.filter((v) => v.isHome);
  const rest = list.filter((v) => !v.isHome);

  // Hero: real shows with artwork first, hot ones first.
  const heroPool = [...real].sort((a, b) => Number(!!b.event.image_url) - Number(!!a.event.image_url) || Number(ticketTone(b.statusLine) === "hot") - Number(ticketTone(a.statusLine) === "hot") || b.event.urgency - a.event.urgency).slice(0, 6);
  const slides: Slide[] = heroPool.map((v) => ({
    id: v.event.id, image: v.event.image_url, artist: nameOf(v), city: v.event.city, venue: v.event.venue_name_raw ?? "Venue TBA",
    when: v.event.start_at ? formatIst(v.event.start_at) : v.event.start_date_local ? formatIstDate(v.event.start_date_local) : "Date TBA",
    status: v.statusLine, hot: ticketTone(v.statusLine) === "hot", sample: v.event.is_demo,
    target: v.countdown?.at ?? v.event.start_at ?? (v.event.start_date_local ? `${v.event.start_date_local}T13:30:00Z` : null),
    targetLabel: v.countdown ? v.countdown.label.replace(" in", "") + " in" : "Show starts in",
  }));
  const ring = [...views].sort((a, b) => Number(!!b.event.image_url) - Number(!!a.event.image_url)).slice(0, 12)
    .map((v) => ({ id: v.event.id, image: v.event.image_url, artist: nameOf(v), city: v.event.city, date: shortDate(v) }));
  const marquee = real.map((v) => `${nameOf(v)} · ${v.event.city} · ${shortDate(v)}`);
  const floaters = [...real].filter((v) => v.event.image_url).slice(0, 6);

  return (
    <div className="space-y-20">
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
        <div className="marquee -mt-10 py-4 border-y border-white/10">
          {[0, 1].map((k) => (
            <div key={k} className="marquee-track" aria-hidden={k === 1}>
              {marquee.map((m, i) => (
                <span key={`${k}-${i}`} className="display text-lg sm:text-xl font-bold whitespace-nowrap flex items-center gap-10">
                  <span className={i % 2 ? "text-white/85" : "grad-text"}>{m}</span><span className="text-[#c084fc]">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {hot.length > 0 && (
        <section className="reveal">
          <SectionTitle label="Act now" title={<>Early-birds <span className="grad-text">open or opening</span></>} sub="These usually sell out within about 6 hours" />
          <TallCarousel>{hot.map((v) => <TallCard key={`hot-${v.event.id}`} v={v} />)}</TallCarousel>
        </section>
      )}

      {ring.length >= 3 && (
        <section className="relative">
          <div className="text-center max-w-2xl mx-auto">
            <div className="text-[11px] font-semibold tracking-[.18em] uppercase text-[#f0abfc] mb-2">On the radar</div>
            <h2 className="text-3xl sm:text-5xl font-extrabold">Every show, <span className="grad-text">always spinning.</span></h2>
            <p className="muted mt-3">Hover to pause the ring, click a poster to open the show. {hb ? `Last scan ${formatIst(hb.at)}.` : ""}</p>
          </div>
          <PosterRing items={ring} />
        </section>
      )}

      <section id="shows" className="space-y-4 scroll-mt-24">
        <SectionTitle label="Browse" title={<>Find your <span className="grad-text">next night out</span></>} />
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Link href={chipHref(sp, { city: undefined })} className={`filter-chip ${!sp.city ? "active" : ""}`}>All cities</Link>
          {cities.map((c) => <Link key={c} href={chipHref(sp, { city: c })} className={`filter-chip ${sp.city === c ? "active" : ""}`}>{c}</Link>)}
        </div>
        <form className="flex flex-wrap gap-2 items-center" action="/#shows">
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
          {(sp.city || sp.artist || sp.demo) && <Link className="text-sm muted underline underline-offset-4" href="/#shows">Reset</Link>}
          <span className="text-[11px] dim ml-auto hidden md:block">Dashed border = unconfirmed source · Sample = demo data, never alerts</span>
        </form>
      </section>

      <section id="bengaluru">
        <SectionTitle label="Home city · top priority" title={<>📍 Bengaluru</>} count={home.length} />
        {home.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{home.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <Empty title="Nothing in Bengaluru right now">Silence means checked, not broken. See <Link className="underline" href="/health">Health</Link>.</Empty>
        )}
      </section>

      <section>
        <SectionTitle label="Worth the trip?" title={<>🇮🇳 Rest of <span className="grad-text">India</span></>} count={rest.length} />
        {rest.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{rest.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <Empty title="No other India shows found yet" />
        )}
      </section>

      {/* Soundtacular-style CTA with floating posters */}
      <section className="relative overflow-hidden rounded-[32px] border border-white/10 px-6 py-16 sm:py-24 text-center" style={{ background: "radial-gradient(600px 300px at 50% 0%, rgba(236,72,153,.35), transparent 70%), linear-gradient(135deg, #2e1065, #4c1d95 45%, #1e1b4b)" }}>
        {floaters.map((v, k) => {
          const pos = [["6%", "12%", -8], ["80%", "8%", 7], ["4%", "62%", 6], ["84%", "58%", -6], ["22%", "78%", -4], ["68%", "80%", 5]][k];
          return (
            <Link key={v.event.id} href={`/event/${v.event.id}`} className="hidden md:block absolute w-[130px] h-[150px] rounded-2xl overflow-hidden border border-white/20 shadow-2xl hover:scale-110 transition" style={{ left: pos[0] as string, top: pos[1] as string, transform: `rotate(${pos[2]}deg)`, animation: `float ${8 + k}s ease-in-out infinite alternate` }}>
              <Poster src={v.event.image_url} name={nameOf(v)} className="w-full h-full object-cover" fontSize={18} />
            </Link>
          );
        })}
        <div className="relative z-10 max-w-xl mx-auto">
          <h2 className="text-4xl sm:text-6xl font-extrabold">Get tickets <span className="grad-text">first.</span></h2>
          <p className="text-white/75 mt-4">One Telegram ping the minute a show or early-bird drops, with the venue, the IST time and the ticket link. Every fact is quoted from its source.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Link href="#bengaluru" className="btn btn-primary">Browse Bengaluru shows</Link>
            <Link href="/alerts" className="btn">See past alerts</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function MiniStat({ v, l }: { v: number; l: string }) {
  return (
    <div className="stat">
      <div className="v"><CountUp to={v} /></div>
      <div className="l">{l}</div>
    </div>
  );
}
