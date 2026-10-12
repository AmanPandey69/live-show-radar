"use client";
import { useMemo, useRef, useState } from "react";
import type { EventView } from "@/lib/view";
import { EventCard } from "./EventCard";
import { ticketTone } from "./ui";

type Tab = "act" | "home" | "rest" | "all";

/** One compact browser instead of long grids: tabs + city chips + a single horizontal row of poster cards. */
export function ShowTabs({ views }: { views: EventView[] }) {
  const [tab, setTab] = useState<Tab>("act");
  const [city, setCity] = useState<string | null>(null);
  const [realOnly, setRealOnly] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  const base = useMemo(() => views.filter((v) => !realOnly || !v.event.is_demo), [views, realOnly]);
  const groups: Record<Tab, EventView[]> = useMemo(() => ({
    act: base.filter((v) => ["hot", "soon"].includes(ticketTone(v.statusLine))),
    home: base.filter((v) => v.isHome),
    rest: base.filter((v) => !v.isHome),
    all: base,
  }), [base]);
  const cities = useMemo(() => [...new Set(groups[tab].map((v) => v.event.city))].sort(), [groups, tab]);
  const list = groups[tab].filter((v) => !city || v.event.city === city);
  const go = (d: number) => row.current?.scrollBy({ left: d * 340, behavior: "smooth" });

  const TABS: [Tab, string][] = [["act", "🔥 Act now"], ["home", "📍 Bengaluru"], ["rest", "🇮🇳 Rest of India"], ["all", "All shows"]];

  return (
    <section id="shows" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="glass rounded-full p-1 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setTab(k); setCity(null); row.current?.scrollTo({ left: 0 }); }}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition ${tab === k ? "text-white shadow-[0_8px_24px_-10px_rgba(168,85,247,.9)]" : "muted hover:text-white"}`}
              style={tab === k ? { background: "linear-gradient(110deg,#7c3aed,#a855f7 40%,#ec4899)" } : undefined}
            >
              {label} <span className="opacity-70 ml-1">{groups[k].length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm muted cursor-pointer select-none">
            <input type="checkbox" className="accent-[#a855f7] w-4 h-4" checked={realOnly} onChange={(e) => setRealOnly(e.target.checked)} />
            Real shows only
          </label>
          <button aria-label="Scroll left" onClick={() => go(-1)} className="btn !p-0 w-10 h-10">‹</button>
          <button aria-label="Scroll right" onClick={() => go(1)} className="btn !p-0 w-10 h-10">›</button>
        </div>
      </div>

      {cities.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
          <button onClick={() => setCity(null)} className={`filter-chip ${!city ? "active" : ""}`}>All cities</button>
          {cities.map((c) => (
            <button key={c} onClick={() => setCity(c)} className={`filter-chip ${city === c ? "active" : ""}`}>{c}</button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="panel p-10 text-center">
          <div className="display text-2xl font-bold">Nothing here right now</div>
          <div className="text-sm muted mt-2">Silence means checked, not broken. The radar scans every few minutes.</div>
        </div>
      ) : (
        <div ref={row} className="flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2 scroll-smooth">
          {list.map((v) => (
            <div key={v.event.id} className="snap-start shrink-0 w-[300px] sm:w-[320px] flex">
              <EventCard v={v} />
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] dim mt-3">Dashed border = unconfirmed source · Sample = demo data that never sends alerts · swipe or use the arrows</div>
    </section>
  );
}
