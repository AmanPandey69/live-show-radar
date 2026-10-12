"use client";
import { useEffect, useState } from "react";

export function Countdown({ at, label }: { at: string; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const ms = Date.parse(at) - now;
  if (ms <= 0) return <span className="chip chip-warn">{label.replace(" in", "")}: now</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    <span className="chip chip-accent tabular-nums">
      ⏱ {label} {d > 0 ? `${d}d ` : ""}{h}h {String(m).padStart(2, "0")}m {String(sec).padStart(2, "0")}s
    </span>
  );
}
