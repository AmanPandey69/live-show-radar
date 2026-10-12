import type { Repo } from "@/lib/db/repo";
import type { Affinity, FeedbackKind } from "@/lib/domain/types";

const UP: Record<Affinity, Affinity> = { casual: "like", like: "must_see", must_see: "must_see" };
const DOWN: Record<Affinity, Affinity> = { must_see: "like", like: "casual", casual: "casual" };

/**
 * Feedback loop:
 *  going/maybe → raise affinity (going: +1 tier, maybe: casual→like) unless manually overridden
 *  not_interested → lower affinity one tier
 *  wrong_artist → namesake block on the event title + mark event rumoured
 *  wrong_info → tighten confidence threshold (+0.05, max 0.9) and demote non-primary confidence
 */
export async function applyFeedback(repo: Repo, p: { event_id: string; alert_id?: string | null; kind: FeedbackKind; channel: string }) {
  const e = await repo.getEvent(p.event_id);
  if (!e) return "event not found";
  await repo.addFeedback({ event_id: e.id, alert_id: p.alert_id ?? null, kind: p.kind, note: null, channel: p.channel } as never);
  const artists = (await repo.listArtists()).filter((a) => e.headliner_ids.includes(a.id) || e.support_ids.includes(a.id));
  for (const a of artists) {
    if (a.affinity_override) continue;
    if (p.kind === "going") await repo.updateArtist(a.id, { affinity: UP[a.affinity] });
    if (p.kind === "maybe" && a.affinity === "casual") await repo.updateArtist(a.id, { affinity: "like" });
    if (p.kind === "not_interested") await repo.updateArtist(a.id, { affinity: DOWN[a.affinity] });
  }
  if (p.kind === "wrong_artist") {
    for (const a of artists) await repo.addBlock({ artist_id: a.id, pattern: e.title.toLowerCase().slice(0, 80), reason: "feedback" });
    await repo.updateEvent(e.id, { confidence: "rumoured", conflicts: [...e.conflicts, { field: "artist", values: [{ value: "wrong artist", source_url: "user feedback", snippet: "" }] }] });
  }
  if (p.kind === "wrong_info") {
    const s = await repo.getSettings();
    await repo.setSettings({ confirm_threshold: Math.min(0.9, +(s.confirm_threshold + 0.05).toFixed(2)) });
    const sources = await repo.listEventSources([e.id]);
    if (!sources.some((x) => x.is_primary)) await repo.updateEvent(e.id, { confidence: "unconfirmed" });
    await repo.updateEvent(e.id, { conflicts: [...e.conflicts, { field: "info", values: [{ value: "user flagged wrong info", source_url: "user feedback", snippet: "" }] }] });
  }
  return `recorded ${p.kind}`;
}
