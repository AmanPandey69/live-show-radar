"use client";
import { useEffect, useState } from "react";

/** Soundtacular-style countdown: Days : Hours : Minutes : Seconds glass boxes. */
export function BigCountdown({ at, label }: { at: string; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, Date.parse(at) - (now ?? Date.parse(at)));
  const s = Math.floor(ms / 1000);
  const parts: [string, number][] = [["Days", Math.floor(s / 86400)], ["Hours", Math.floor((s % 86400) / 3600)], ["Minutes", Math.floor((s % 3600) / 60)], ["Seconds", s % 60]];
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[.16em] text-white/60 font-semibold mb-2">{label}</div>
      <div className="flex items-center gap-2">
        {parts.map(([l, v], k) => (
          <div key={l} className="flex items-center gap-2">
            <div className="rounded-2xl w-[68px] sm:w-[76px] py-2.5 text-center bg-[#0c0717]/80 backdrop-blur-xl border border-white/10">
              <div className="display text-[28px] sm:text-[32px] font-bold leading-none tabular-nums">{now === null ? "--" : String(v).padStart(2, "0")}</div>
              <div className="text-[10px] text-white/60 mt-1">{l}</div>
            </div>
            {k < 3 && <span className="text-white/40 text-xl font-bold">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
