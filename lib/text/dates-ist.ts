import { DateTime } from "luxon";

export const IST = "Asia/Kolkata";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_RE = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

export interface LocalDate { date: string; time: string | null; match: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** IST wall-clock → UTC ISO string. `time` "HH:mm" (defaults to 00:00, caller decides if that's meaningful). */
export function istToUtc(date: string, time: string | null = null): string {
  const dt = DateTime.fromISO(`${date}T${time ?? "00:00"}`, { zone: IST });
  if (!dt.isValid) throw new Error(`invalid IST date/time: ${date} ${time}`);
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

export function utcToIstDate(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(IST).toISODate()!;
}

export function utcToIstTime(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(IST).toFormat("HH:mm");
}

/** "Sat 14 Nov, 7:00pm IST" (time omitted when unknown). */
export function formatIst(iso: string | null, opts: { withTime?: boolean; withYear?: boolean } = {}): string {
  if (!iso) return "date not stated";
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(IST);
  const day = dt.toFormat(opts.withYear ? "ccc d LLL yyyy" : "ccc d LLL");
  if (opts.withTime === false) return day;
  return `${day}, ${dt.toFormat("h:mma").toLowerCase()} IST`;
}

export function formatIstDate(date: string): string {
  return DateTime.fromISO(date, { zone: IST }).toFormat("ccc d LLL yyyy");
}

/** "3h 12m", "2d 4h", "45m". Negative → "0m". */
export function humanizeDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

/** Parse a time: "7 PM", "7pm", "7:30 pm", "19:00", "10am", "11.59pm", "noon", "midnight". → "HH:mm" */
export function parseTime(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return "12:00";
  if (/\bmidnight\b/.test(t)) return "23:59";
  let m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const pm = m[3].startsWith("p");
    if (h < 1 || h > 12 || min > 59) return null;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${pad(h)}:${pad(min)}`;
  }
  m = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:hrs?|h|ist)?\b/.exec(t);
  if (m) return `${pad(Number(m[1]))}:${m[2]}`;
  return null;
}

function inferYear(month: number, day: number, ref: DateTime): number {
  // No year given: take this year's date unless it is more than 30 days in the past, then next year.
  const thisYear = DateTime.fromObject({ year: ref.year, month, day }, { zone: IST });
  return thisYear < ref.minus({ days: 30 }) ? ref.year + 1 : ref.year;
}

function mk(year: number, month: number, day: number): string | null {
  const dt = DateTime.fromObject({ year, month, day }, { zone: IST });
  return dt.isValid ? dt.toISODate() : null;
}

/**
 * Parse the first date in Indian-style text. DD/MM is assumed for numeric dates (Indian convention)
 * unless the second number is > 12. `ref` resolves missing years and relative words.
 */
export function parseIndianDate(text: string, ref: Date = new Date()): LocalDate | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const r = DateTime.fromJSDate(ref).setZone(IST).startOf("day");
  const time = parseTime(t);
  let m: RegExpExecArray | null;

  // ISO 2026-11-15
  if ((m = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t))) {
    const d = mk(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return { date: d, time, match: m[0] };
  }
  // 15th Nov(ember)( 2026) | 15 Nov, 2026 | 15-Nov-26
  // 2-digit years only in compact forms ("14-Nov-26", "14 Nov '26"), so "20 Oct, 12 PM" keeps 12 as the hour.
  if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:of\\s+)?|-)${MONTH_RE}\\b(?:,?\\s*(\\d{4})\\b(?![:.]\\d)|(?:-|\\s')(\\d{2})\\b)?`).exec(t))) {
    const day = Number(m[1]);
    const month = MONTHS[m[2]];
    const year = m[3] ? Number(m[3]) : m[4] ? 2000 + Number(m[4]) : inferYear(month, day, r);
    const d = mk(year, month, day);
    if (d) return { date: d, time, match: m[0] };
  }
  // Nov 15(th)(, 2026)
  if ((m = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s+(\\d{4})\\b)?`).exec(t))) {
    const month = MONTHS[m[1]];
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, r);
    const d = mk(year, month, day);
    if (d) return { date: d, time, match: m[0] };
  }
  // 15/11/2026, 15-11-26, 15.11.2026, 15/11
  if ((m = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b/.exec(t))) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    if (b > 12 && a <= 12) [a, b] = [b, a]; // clearly MM/DD
    // Avoid reading times like 10.30 as dates when no year is present.
    if (m[3] || /[/-]/.test(m[0])) {
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear(b, a, r);
      const d = mk(year, b, a);
      if (d) return { date: d, time, match: m[0] };
    }
  }
  // today / tonight / tomorrow
  if ((m = /\b(today|tonight|tomorrow)\b/.exec(t))) {
    const d = m[1] === "tomorrow" ? r.plus({ days: 1 }) : r;
    return { date: d.toISODate()!, time, match: m[0] };
  }
  // (this|next) Saturday → next occurrence on/after ref (strictly after when "next")
  if ((m = new RegExp(`\\b(this |next |coming )?${WEEKDAY_RE}\\b`).exec(t))) {
    const target = WEEKDAYS[m[2]];
    let delta = (target - r.weekday + 7) % 7;
    if (m[1]?.trim() === "next" && delta === 0) delta = 7;
    return { date: r.plus({ days: delta }).toISODate()!, time, match: m[0] };
  }
  return null;
}

/** Split "Doors 6pm | Show 7:30pm" into separate times. Show time falls back to the only time stated. */
export function parseDoorsAndShow(text: string): { doors: string | null; show: string | null } {
  const t = text.toLowerCase();
  const doorsM = /doors?(?:\s+open)?(?:\s+at|\s*:|\s*-)?\s*([0-9:.]+\s*(?:am|pm)?)/.exec(t);
  const showM = /(?:show(?:\s*time)?|starts?|gig starts|performance)(?:\s+at|\s*:|\s*-)?\s*([0-9:.]+\s*(?:am|pm)?)/.exec(t);
  const doors = doorsM ? parseTime(doorsM[1]) : null;
  const show = showM ? parseTime(showM[1]) : doors ? null : parseTime(t);
  return { doors, show };
}
