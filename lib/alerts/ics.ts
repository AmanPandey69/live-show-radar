import type { EventRow, TicketTier } from "@/lib/domain/types";

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace(/Z?$/, "Z");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const fold = (line: string) => (line.length <= 74 ? line : line.match(/.{1,74}/g)!.join("\r\n "));

const ALARMS = ["-PT24H", "-PT1H", "-PT10M"].map((t) => ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Ticket sale reminder", `TRIGGER:${t}`, "END:VALARM"]).flat();

/** .ics with the show (if dated) plus one event per known sale window, each with T-24h / T-1h / T-10m alarms. */
export function buildIcs(e: EventRow, tiers: TicketTier[], title: string, url: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Live Show Radar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const now = stamp(new Date().toISOString());
  const add = (uid: string, start: string, end: string | null, summary: string, desc: string, alarms: boolean, allDay = false) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@live-show-radar`, `DTSTAMP:${now}`);
    if (allDay) lines.push(`DTSTART;VALUE=DATE:${start.replace(/-/g, "")}`);
    else lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end ?? new Date(Date.parse(start) + 30 * 60_000).toISOString())}`);
    lines.push(fold(`SUMMARY:${esc(summary)}`), fold(`DESCRIPTION:${esc(desc)}`), fold(`URL:${url}`));
    if (e.venue_name_raw) lines.push(fold(`LOCATION:${esc(`${e.venue_name_raw}, ${e.city}`)}`));
    if (alarms) lines.push(...ALARMS);
    lines.push("END:VEVENT");
  };
  if (e.start_at) add(`${e.id}-show`, e.start_at, new Date(Date.parse(e.start_at) + 3 * 3_600_000).toISOString(), title, `Show. Details: ${url}`, false);
  else if (e.start_date_local) add(`${e.id}-show`, e.start_date_local, null, title, `Show (time not stated). Details: ${url}`, false, true);
  for (const t of tiers) {
    if (t.sale_start_at) add(`${e.id}-${t.id}-open`, t.sale_start_at, null, `${t.name_raw} opens: ${title}`, `Ticket sale opens. Evidence: "${t.evidence_snippet}"`, true);
    if (t.sale_end_at) add(`${e.id}-${t.id}-close`, t.sale_end_at, null, `${t.name_raw} closes: ${title}`, `Ticket tier closes. Evidence: "${t.evidence_snippet}"`, true);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Google Calendar template link (Google links cannot carry alarms; the .ics has them). */
export function googleCalendarUrl(e: EventRow, title: string, url: string, tier?: TicketTier): string {
  const start = tier?.sale_start_at ?? e.start_at;
  const p = new URLSearchParams({ action: "TEMPLATE", text: tier ? `${tier.name_raw} opens: ${title}` : title, details: `Details: ${url}`, location: e.venue_name_raw ? `${e.venue_name_raw}, ${e.city}` : e.city });
  if (start) {
    const end = new Date(Date.parse(start) + (tier ? 30 * 60_000 : 3 * 3_600_000)).toISOString();
    p.set("dates", `${stamp(start)}/${stamp(end)}`);
  } else if (e.start_date_local) {
    const d = e.start_date_local.replace(/-/g, "");
    const next = new Date(Date.parse(e.start_date_local) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
    p.set("dates", `${d}/${next}`);
  }
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
