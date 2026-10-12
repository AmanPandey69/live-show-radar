import { DateTime } from "luxon";

export function PageHeader({ eyebrow, title, children, right }: { eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4 reveal">
      <div>
        {eyebrow && <div className="text-[11px] font-semibold tracking-[.18em] uppercase text-[#f0abfc] mb-3">{eyebrow}</div>}
        <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1]">{title}</h1>
        {children && <div className="muted mt-3 max-w-2xl text-[15px] leading-relaxed">{children}</div>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ value, label }: { value: React.ReactNode; label: string; light?: boolean }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

/** Calendar-style date tile (IST). */
export function DateBlock({ date, iso }: { date: string | null; iso?: string | null }) {
  const dt = iso ? DateTime.fromISO(iso, { zone: "utc" }).setZone("Asia/Kolkata") : date ? DateTime.fromISO(date, { zone: "Asia/Kolkata" }) : null;
  if (!dt || !dt.isValid) return <div className="date-block"><div className="m">TBA</div><div className="d">·</div><div className="w">date</div></div>;
  return (
    <div className="date-block">
      <div className="m">{dt.toFormat("LLL")}</div>
      <div className="d">{dt.toFormat("d")}</div>
      <div className="w">{dt.toFormat("ccc")}</div>
    </div>
  );
}

export type TicketTone = "hot" | "soon" | "bad" | "plain";
export function ticketTone(line: string): TicketTone {
  if (/^(EARLY-BIRD|PHASE-1 \(early tier\)) OPEN NOW|^PRESALE OPEN NOW/.test(line)) return "hot";
  if (/OPENS|announced|should be open/.test(line)) return "soon";
  if (/SOLD OUT|closed/.test(line)) return "bad";
  return "plain";
}

export function TicketLine({ line }: { line: string }) {
  const tone = ticketTone(line);
  return (
    <div className={`ticket ${tone === "plain" ? "" : `ticket-${tone}`}`}>
      <span className="tk-dot" />
      <span>{line}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel p-10 text-center">
      <div className="display text-2xl font-bold">{title}</div>
      {children && <div className="text-sm muted mt-2">{children}</div>}
    </div>
  );
}

export function SectionTitle({ title, sub, count, label }: { title: React.ReactNode; sub?: string; count?: number; label?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        {label && <div className="text-[11px] font-semibold tracking-[.18em] uppercase text-[#f0abfc] mb-2">{label}</div>}
        <h2 className="text-3xl sm:text-4xl font-extrabold leading-none">{title}</h2>
        {sub && <div className="text-sm muted mt-2">{sub}</div>}
      </div>
      {count !== undefined && <div className="display text-5xl font-extrabold leading-none grad-text">{count}</div>}
    </div>
  );
}
