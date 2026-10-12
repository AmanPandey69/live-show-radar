"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventView } from "@/lib/view";
import { EventCard } from "./EventCard";
import { ticketTone } from "./ui";

type Tab = "act" | "all";
const HOME = "Bengaluru";

/** Compact show browser: one city dropdown (default Bengaluru) + two tabs + a single horizontal row of poster cards. */
export function ShowTabs({ views }: { views: EventView[] }) {
  const [city, setCity] = useState<string>(HOME);
  const [tab, setTab] = useState<Tab>("all");
  const [realOnly, setRealOnly] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  // Hero stat tiles dispatch {city, tab} to pre-filter this browser.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ city?: string; tab?: Tab }>).detail ?? {};
      if (d.city) setCity(d.city);
      if (d.tab) setTab(d.tab);
      setRealOnly(true);
      row.current?.scrollTo({ left: 0 });
    };
    window.addEventListener("lsr:filter", on);
    return () => window.removeEventListener("lsr:filter", on);
  }, []);

  const base = useMemo(() => views.filter((v) => !realOnly || !v.event.is_demo), [views, realOnly]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of base) m.set(v.event.city, (m.get(v.event.city) ?? 0) + 1);
    return m;
  }, [base]);
  const cities = useMemo(() => [HOME, ...[...counts.keys()].filter((c) => c !== HOME).sort()], [counts]);
  const inCity = base.filter((v) => city === "all" || v.event.city === city);
  const groups: Record<Tab, EventView[]> = {
    act: inCity.filter((v) => ["hot", "soon"].includes(ticketTone(v.statusLine))),
    all: inCity,
  };
  const list = groups[tab];
  const go = (d: number) => row.current?.scrollBy({ left: d * 340, behavior: "smooth" });
  const TABS: [Tab, string][] = [["all", "All shows"], ["act", "🔥 Act now"]];

  return (
    <section id="shows" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* City dropdown */}
          <label className="relative group">
            <span className="sr-only">City</span>
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px]">📍</span>
            <select
              value={city}
              onChange={(e) => { setCity(e.target.value); row.current?.scrollTo({ left: 0 }); }}
              className="appearance-none !rounded-full !pl-11 !pr-11 !py-3 !text-[15px] font-semibold cursor-pointer !bg-white/[.07] hover:!bg-white/[.11] !border-white/15 min-w-[220px]"
            >
              {cities.map((c) => (
                <option key={c} value={c}>{c} ({counts.get(c) ?? 0})</option>
              ))}
              <option value="all">All of India ({base.length})</option>
            </select>
            <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 opacity-70 group-hover:opacity-100" width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </label>

          {/* Tabs */}
          <div className="glass rounded-full p-1 flex gap-1">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setTab(k); row.current?.scrollTo({ left: 0 }); }}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition ${tab === k ? "text-white shadow-[0_8px_24px_-10px_rgba(168,85,247,.9)]" : "muted hover:text-white"}`}
                style={tab === k ? { background: "linear-gradient(110deg,#7c3aed,#a855f7 40%,#ec4899)" } : undefined}
              >
                {label} <span className="opacity-70 ml-1">{groups[k].length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm muted cursor-pointer select-none mr-1">
            <input type="checkbox" className="accent-[#a855f7] w-4 h-4" checked={realOnly} onChange={(e) => setRealOnly(e.target.checked)} />
            Real shows only
          </label>
          <button aria-label="Scroll left" onClick={() => go(-1)} className="btn !p-0 w-10 h-10">‹</button>
          <button aria-label="Scroll right" onClick={() => go(1)} className="btn !p-0 w-10 h-10">›</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="panel p-10 text-center">
          <div className="display text-2xl font-bold">Nothing {tab === "act" ? "to act on" : "on"} in {city === "all" ? "India" : city} right now</div>
          <div className="text-sm muted mt-2">Silence means checked, not broken. Try another city from the dropdown.</div>
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
