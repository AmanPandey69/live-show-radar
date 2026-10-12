import Link from "next/link";
import type { EventView } from "@/lib/view";
import { formatIst } from "@/lib/text/dates-ist";
import { Countdown } from "./Countdown";
import { Poster } from "./Poster";
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

/** District-style poster card: artwork on top, date tile overlaid, details + ticket line below. */
export function EventCard({ v }: { v: EventView }) {
  const e = v.event;
  const hot = ticketTone(v.statusLine) === "hot";
  const time = e.start_at ? formatIst(e.start_at).split(", ")[1] : "time TBA";
  const sources = [...new Set(v.sources.map((s) => host(s.url)))];
  const name = v.artists.join(" + ") || e.title;
  return (
    <Link href={`/event/${e.id}`} className={`pcard flex flex-col ${hot ? "pcard-hot" : ""} ${e.confidence !== "confirmed" ? "unconfirmed" : ""}`}>
      <div className="relative overflow-hidden">
        <Poster src={e.image_url} name={name} className="pimg aspect-[16/10]" fontSize={30} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#120b24] via-transparent to-transparent" />
        <div className="absolute top-3 left-3"><DateBlock date={e.start_date_local} iso={e.start_at} /></div>
        <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-1.5 max-w-[60%]">
          {e.is_demo && <span className="chip chip-demo">Sample</span>}
          {v.isNew && <span className="chip chip-accent">New</span>}
          {e.priority === "P0" && <span className="chip chip-dark">P0</span>}
        </div>
      </div>
      <div className="p-4 pt-1 flex flex-col flex-1">
        <div className="flex flex-wrap gap-1.5 mb-2"><StatusChip s={e.status} /><ConfidenceChip c={e.confidence} /></div>
        <div className="display text-[22px] font-bold leading-tight line-clamp-2">{name}</div>
        <div className="text-sm muted mt-1 truncate">📍 {e.venue_name_raw ?? "Venue TBA"}, <span className="text-white font-medium">{e.city}</span> · {time}</div>
        <div className="mt-3"><TicketLine line={v.statusLine} /></div>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] dim truncate">{sources.slice(0, 2).join(" · ")}</span>
          {v.countdown ? <Countdown at={v.countdown.at} label={v.countdown.label} /> : <span className="text-sm text-[#e9d5ff] font-semibold">Details →</span>}
        </div>
      </div>
    </Link>
  );
}

/** Tall photo card (Musician-style) for horizontal carousels. */
export function TallCard({ v }: { v: EventView }) {
  const e = v.event;
  const name = v.artists.join(" + ") || e.title;
  return (
    <Link href={`/event/${e.id}`} className="tall">
      <Poster src={e.image_url} name={name} className="w-full h-full object-cover" fontSize={34} />
      <div className="shade" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="text-[11px] text-white/70 font-semibold tracking-wide">{e.start_date_local ? formatIst(`${e.start_date_local}T06:30:00Z`, { withTime: false, withYear: true }) : "Date TBA"}</div>
        <div className="display text-[22px] font-bold leading-tight mt-1 line-clamp-2">{name}</div>
        <div className="text-xs text-white/70 mt-1 truncate">{e.city}{e.venue_name_raw ? ` · ${e.venue_name_raw}` : ""}</div>
        <div className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full bg-white text-[#1a0b2e]">{ticketTone(v.statusLine) === "hot" ? "Early-bird open" : "View show"} →</div>
      </div>
    </Link>
  );
}
