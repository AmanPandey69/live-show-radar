import Link from "next/link";
import { EventCard } from "@/components/EventCard";
import { getRepo } from "@/lib/db";
import { loadRadar } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ city?: string; artist?: string; demo?: string }> }) {
  const sp = await searchParams;
  const { views, cities, artistNames, artists } = await loadRadar({ city: sp.city, artist: sp.artist });
  const hb = await getRepo().getKv<{ at: string; lane: string }>("heartbeat");
  const showDemo = sp.demo !== "0";
  const list = views.filter((v) => showDemo || !v.event.is_demo);
  const home = list.filter((v) => v.isHome);
  const rest = list.filter((v) => !v.isHome);
  const real = views.filter((v) => !v.event.is_demo).length;

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h1 className="text-2xl font-extrabold">Upcoming shows for the artists you follow</h1>
        <p className="muted text-sm mt-1">
          {artists.length} artists monitored · {real} real upcoming India shows found · Bengaluru first, then the rest of India.
          {hb ? ` Last scan heartbeat: ${new Date(hb.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST (${hb.lane}).` : " No scan has run yet."}
        </p>
        <form className="flex flex-wrap gap-2 mt-4 text-sm" action="/">
          <select name="city" defaultValue={sp.city ?? ""}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select name="artist" defaultValue={sp.artist ?? ""}>
            <option value="">All artists</option>
            {artistNames.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select name="demo" defaultValue={showDemo ? "1" : "0"}>
            <option value="1">Show SAMPLE data</option>
            <option value="0">Hide SAMPLE data</option>
          </select>
          <button className="btn">Filter</button>
          {(sp.city || sp.artist) && <Link className="btn" href="/">Clear</Link>}
        </form>
        <p className="text-xs muted mt-3">
          Dashed border = unconfirmed (single non-official source). <span className="chip chip-demo">SAMPLE</span> = clearly fake demo data that never sends real alerts.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">📍 Bengaluru <span className="muted text-sm font-normal">({home.length})</span></h2>
        {home.length ? (
          <div className="grid gap-3 md:grid-cols-2">{home.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <p className="muted text-sm">No upcoming Bengaluru shows found for your artists right now. Silence means checked, not unchecked; see <Link className="underline" href="/health">Health</Link>.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">🇮🇳 Rest of India <span className="muted text-sm font-normal">({rest.length})</span></h2>
        {rest.length ? (
          <div className="grid gap-3 md:grid-cols-2">{rest.map((v) => <EventCard key={v.event.id} v={v} />)}</div>
        ) : (
          <p className="muted text-sm">No other India shows found yet.</p>
        )}
      </section>
    </div>
  );
}
