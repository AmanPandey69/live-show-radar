import Link from "next/link";
import type { EventView } from "@/lib/view";
import { formatIst } from "@/lib/text/dates-ist";
import { Countdown } from "./Countdown";
import { DateBlock, TicketLine, ticketTone } from "./ui";

export const STATUS_CHIP: Record<string, string> = {
  early_bird: "chip-accent", presale: "chip-violet", general_sale: "chip-ok", announced: "", rumoured: "chip-warn",
  sold_out: "chip-bad", cancelled: "chip-bad", postponed: "chip-warn",
};
const STATUS_LABEL: Record<string, string> = {
  early_bird: "Early-bird", presale: "Presale", general_sale: "On sale", announced: "Announced", rumoured: "Rumoured",
  sold_out: "Sold out", cancelled: "Cancelled", postponed: "Postponed",
};

export function ConfidenceChip({ c }: { c: string }) {
  if (c === "confirmed") return <span className="chip chip-ok">✓ Confirmed</span>;
  if (c === "unconfirmed") return <span className="chip chip-warn">Unconfirmed</span>;
  return <span className="chip chip-warn">Rumour</span>;
}

export function StatusChip({ s }: { s: string }) {
  return <span className={`chip ${STATUS_CHIP[s] ?? ""}`}>{STATUS_LABEL[s] ?? s}</span>;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function EventCard({ v }: { v: EventView }) {
  const e = v.event;
  const hot = ticketTone(v.statusLine) === "hot";
  const time = e.start_at ? formatIst(e.start_at).split(", ")[1] : "time TBA";
  const sources = [...new Set(v.sources.map((s) => host(s.url)))];
  return (
    <Link href={`/event/${e.id}`} className={`card p-5 flex flex-col ${hot ? "card-hot" : ""} ${e.confidence !== "confirmed" ? "unconfirmed" : ""}`}>
      <div className="flex gap-4">
        <DateBlock date={e.start_date_local} iso={e.start_at} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            {e.is_demo && <span className="chip chip-demo">Sample</span>}
            {e.priority === "P0" && <span className="chip chip-dark">P0</span>}
            {v.isNew && <span className="chip chip-accent">New</span>}
            <StatusChip s={e.status} />
          </div>
          <div className="serif text-[28px] leading-[1.02] mt-2 line-clamp-2">{v.artists.join(" + ") || e.title}</div>
        </div>
      </div>
      <div className="mt-3 text-sm muted">
        <span className="text-[var(--text)] font-medium">{e.city}</span> · {e.venue_name_raw ?? "venue not stated"} · {time}
      </div>
      <div className="mt-4"><TicketLine line={v.statusLine} /></div>
      <div className="mt-auto pt-4 flex items-center justify-between gap-2">
        <div className="mono text-[10px] tracking-[.08em] uppercase dim truncate">
          <ConfidenceChip c={e.confidence} /> <span className="ml-1">{sources.slice(0, 2).join(" · ")}</span>
        </div>
        {v.countdown ? <Countdown at={v.countdown.at} label={v.countdown.label} /> : <span className="text-sm">→</span>}
      </div>
    </Link>
  );
}
