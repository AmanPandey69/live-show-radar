import type { Repo } from "@/lib/db/repo";
import type { EventRow, Reminder, TicketTier } from "@/lib/domain/types";

const OFFSETS: { label: Reminder["offset_label"]; ms: number }[] = [
  { label: "T-24h", ms: 24 * 3_600_000 },
  { label: "T-1h", ms: 3_600_000 },
  { label: "T-10m", ms: 10 * 60_000 },
];
const WATCHED = new Set(["early_bird", "phase_1", "presale_card", "presale_membership"]);

/** Reminder plan for known sale openings and closings of early/presale tiers. Past offsets are skipped. */
export function planReminders(event: EventRow, tiers: TicketTier[], now: Date, opts: { includeGeneral?: boolean } = {}) {
  const out: Omit<Reminder, "id">[] = [];
  for (const t of tiers) {
    if (!WATCHED.has(t.tier_type) && !opts.includeGeneral) continue;
    const targets: [Reminder["kind"], string | null][] = [
      ["sale_open", t.availability === "upcoming" ? t.sale_start_at : null],
      ["sale_close", t.availability === "open" || t.availability === "upcoming" ? t.sale_end_at : null],
    ];
    for (const [kind, target] of targets) {
      if (!target) continue;
      const tt = Date.parse(target);
      for (const o of OFFSETS) {
        const fire = tt - o.ms;
        if (fire <= now.getTime()) continue;
        out.push({
          event_id: event.id, tier_id: t.id, kind, offset_label: o.label, target_at: target, fire_at: new Date(fire).toISOString(),
          dedupe_key: `${event.id}|${t.id}|${kind}|${o.label}|${target}`, sent_at: null, is_demo: event.is_demo,
        });
      }
    }
  }
  return out;
}

export async function scheduleReminders(repo: Repo, event: EventRow, tiers: TicketTier[], now: Date, opts: { includeGeneral?: boolean } = {}) {
  const plan = planReminders(event, tiers, now, opts);
  const existing = await repo.listReminders(event.id);
  const keep = new Set(plan.map((p) => p.dedupe_key));
  // Times changed → drop stale unsent reminders, then insert the new plan (dedupe keys prevent repeats).
  if (existing.some((r) => !r.sent_at && !keep.has(r.dedupe_key))) await repo.deleteUnsentReminders(event.id);
  let n = 0;
  for (const p of plan) if (await repo.insertReminderIfNew(p)) n++;
  return n;
}
