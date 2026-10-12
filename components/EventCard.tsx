import Link from "next/link";
import type { EventView } from "@/lib/view";
import { formatIst, formatIstDate } from "@/lib/text/dates-ist";
import { Countdown } from "./Countdown";

export const STATUS_CHIP: Record<string, string> = {
  early_bird: "chip-accent", presale: "chip-accent", general_sale: "chip-ok", announced: "", rumoured: "chip-warn",
  sold_out: "chip-bad", cancelled: "chip-bad", postponed: "chip-warn",
};

export function ConfidenceChip({ c }: { c: string }) {
  if (c === "confirmed") return <span className="chip chip-ok">✓ Confirmed</span>;
  if (c === "unconfirmed") return <span className="chip chip-warn">? Unconfirmed</span>;
  return <span className="chip chip-warn">~ Rumoured</span>;
}

export function EventCard({ v }: { v: EventView }) {
  const e = v.event;
  const when = e.start_at ? formatIst(e.start_at) : e.start_date_local ? `${formatIstDate(e.start_date_local)} · time not stated` : "Date not stated";
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  return (
    <Link href={`/event/${e.id}`} className={`panel block p-4 hover:border-[var(--accent)] transition ${e.confidence !== "confirmed" ? "unconfirmed" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {e.is_demo && <span className="chip chip-demo">SAMPLE</span>}
        {v.isNew && <span className="chip chip-accent">NEW</span>}
        <span className={`chip ${e.priority === "P0" ? "chip-accent" : ""}`}>{e.priority}</span>
        <span className={`chip ${STATUS_CHIP[e.status] ?? ""}`}>{e.status.replace("_", " ")}</span>
        <ConfidenceChip c={e.confidence} />
        {e.is_festival && <span className="chip">Festival</span>}
      </div>
      <div className="text-lg font-bold leading-tight">{v.artists.join(" + ") || e.title}</div>
      <div className="text-sm muted mt-0.5 line-clamp-1">{e.title}</div>
      <div className="mt-2 text-sm">
        <div>📍 {e.venue_name_raw ?? "Venue not stated"}, <b>{e.city}</b></div>
        <div>📅 {when}</div>
      </div>
      <div className="mt-2 text-sm font-semibold text-[#ffc2d3]">🎟 {v.statusLine}</div>
      {v.countdown && <div className="mt-2"><Countdown at={v.countdown.at} label={v.countdown.label} /></div>}
      <div className="mt-2 text-xs muted">
        Sources: {[...new Set(v.sources.map((s) => host(s.url)))].slice(0, 3).join(", ") || "n/a"}
      </div>
    </Link>
  );
}
