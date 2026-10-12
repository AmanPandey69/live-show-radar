"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useState } from "react";
import { BigCountdown } from "./BigCountdown";

export interface Slide { id: string; image: string | null; artist: string; city: string; venue: string; when: string; status: string; hot: boolean; sample: boolean; target: string | null; targetLabel: string }

const FALLBACK = ["linear-gradient(120deg,#4c1d95,#9d174d)", "linear-gradient(120deg,#1e3a8a,#6d28d9)", "linear-gradient(120deg,#701a75,#1d4ed8)"];

/** Full-bleed auto-rotating hero: crossfade + slow Ken Burns zoom, dots, prev/next, pauses on hover. */
export function HeroCarousel({ slides, stats }: { slides: Slide[]; stats: React.ReactNode }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 5500);
    return () => clearInterval(t);
  }, [paused, n]);
  const s = slides[i];

  return (
    <section
      className="relative overflow-hidden rounded-[32px] border border-white/10 min-h-[440px] flex flex-col justify-end"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((sl, k) => (
        <div key={sl.id} className="absolute inset-0 transition-opacity duration-[1200ms]" style={{ opacity: k === i ? 1 : 0 }}>
          {sl.image ? (
            <img src={sl.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" style={{ transform: k === i ? "scale(1.12)" : "scale(1)", transition: "transform 7s ease-out", filter: "saturate(1.15)" }} />
          ) : (
            <div className="w-full h-full" style={{ background: FALLBACK[k % FALLBACK.length] }} />
          )}
        </div>
      ))}
      {/* purple blend overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#07040f] via-[#07040f]/55 to-[#2e1065]/30" />
      <div className="absolute inset-0 mix-blend-color bg-gradient-to-br from-[#6d28d9]/45 via-transparent to-[#db2777]/40" />
      <div className="hero-word">LIVE</div>

      <div className="relative z-10 p-6 sm:p-9">
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="chip"><span className="radar-dot mr-1" /> Scanning live</span>
          {s?.sample && <span className="chip chip-demo">Sample</span>}
          {s?.hot && <span className="chip chip-dark">Early-bird open</span>}
        </div>
        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-6 items-end">
          <div>
            <div className="text-[11px] uppercase tracking-[.18em] font-semibold inline-block px-3 py-1 rounded-full bg-[#a855f7]/25 border border-[#c084fc]/40 text-[#f5d0fe] mb-4">India tour radar · Bengaluru first</div>
            <h1 className="text-[40px] sm:text-[64px] font-extrabold leading-[.95]">
              Never miss a show <span className="grad-text">again.</span>
            </h1>
            {s?.target && <div key={`cd-${s.id}`} className="reveal mt-5"><BigCountdown at={s.target} label={s.targetLabel} /></div>}
          </div>
          {s && (
            <div key={s.id} className="reveal glass rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[.14em] text-[#f0abfc] font-semibold">Now featuring · {s.when}</div>
                <div className="display text-2xl font-bold truncate mt-1">{s.artist}</div>
                <div className="text-sm muted truncate">{s.venue.toLowerCase().includes(s.city.toLowerCase()) ? s.venue : `${s.venue} · ${s.city}`}</div>
                <div className="text-sm mt-1.5 font-semibold">{s.status}</div>
              </div>
              <Link href={`/event/${s.id}`} className="btn btn-primary">View show →</Link>
            </div>
          )}
        </div>
        <div className="mt-6">{stats}</div>
        {n > 1 && (
          <div className="flex items-center gap-3 mt-5">
            <button aria-label="Previous" onClick={() => setI((i - 1 + n) % n)} className="btn !p-0 w-10 h-10">‹</button>
            <div className="flex gap-1.5">
              {slides.map((sl, k) => (
                <button key={sl.id} aria-label={`Slide ${k + 1}`} onClick={() => setI(k)} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 34 : 10, background: k === i ? "linear-gradient(90deg,#a855f7,#ec4899)" : "rgba(255,255,255,.25)" }} />
              ))}
            </div>
            <button aria-label="Next" onClick={() => setI((i + 1) % n)} className="btn !p-0 w-10 h-10">›</button>
          </div>
        )}
      </div>
    </section>
  );
}
