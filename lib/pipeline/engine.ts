import { decideAlerts, headlineType, alertPriority, type AlertFact } from "@/lib/alerts/decide";
import { renderAlert, defaultWhy, artistNames } from "@/lib/alerts/render";
import { scheduleReminders } from "@/lib/alerts/reminders";
import { aiExtract, aiResolve, aiVerify, aiVision, aiWhisper, aiWhy } from "@/lib/ai/tasks";
import type { Gemini } from "@/lib/ai/gemini";
import type { Repo } from "@/lib/db/repo";
import { effectiveAffinity } from "@/lib/domain/rules";
import type { Candidate, ObservationInput } from "@/lib/domain/schemas";
import type { Artist, EventRow, Settings } from "@/lib/domain/types";
import { deliver, type Channels } from "@/lib/notify/dispatch";
import { MockNotifier } from "@/lib/notify/notifiers";
import { canonicalCity } from "@/lib/text/cities";
import { formatIst, utcToIstDate } from "@/lib/text/dates-ist";
import { ArtistMatcher, type ArtistMatch } from "@/lib/text/match";
import { sha256 } from "@/lib/text/normalize";
import { prefilter } from "@/lib/text/prefilter";
import { heuristicExtract } from "./heuristic";
import { bestAffinity, mergeCandidate, type MergeResult } from "./merge";
import { enforceTruth } from "./truth";

export interface IngestOutcome {
  status: "unchanged" | "filtered_out" | "whisper" | "deferred" | "rejected" | "merged" | "error";
  reason?: string;
  events: { id: string; isNew: boolean; alerts: number }[];
}

export interface EngineOptions {
  homeCity: string;
  appBaseUrl: string;
  now?: () => Date;
  log?: (m: string) => void;
}

/** Observation → (pre-filter → extract → verify → resolve → merge → alerts → reminders). */
export class Engine {
  matcher!: ArtistMatcher;
  artists: Artist[] = [];
  settings!: Settings;
  readonly mock: MockNotifier;
  stats = { observations: 0, unchanged: 0, filtered: 0, merged: 0, newEvents: 0, alerts: 0, rejected: 0, whispers: 0, fallbacks: 0, deferred: 0 };

  constructor(public repo: Repo, public gemini: Gemini, public channels: Channels, public opts: EngineOptions) {
    this.mock = channels.mock;
  }

  now() { return this.opts.now?.() ?? new Date(); }
  log(m: string) { this.opts.log?.(m); }

  async refresh() {
    const [artists, aliases, blocks] = await Promise.all([this.repo.listArtists(), this.repo.listAliases(), this.repo.listBlocks()]);
    this.artists = artists;
    this.matcher = new ArtistMatcher({ artists, aliases, blocks });
    this.settings = await this.repo.getSettings();
    return this;
  }

  private today() { return utcToIstDate(this.now().toISOString()); }

  private priorityFor(matches: ArtistMatch[]) {
    const tiers = this.artists.filter((a) => matches.some((m) => m.artist_id === a.id)).map(effectiveAffinity);
    return tiers.includes("must_see") ? ("high" as const) : tiers.includes("like") ? ("normal" as const) : ("low" as const);
  }

  async ingest(o: ObservationInput, opts: { allowDemoSend?: boolean } = {}): Promise<IngestOutcome> {
    this.stats.observations++;
    if (await this.repo.findObservation(o.source_id, o.url, o.content_hash)) {
      this.stats.unchanged++;
      return { status: "unchanged", events: [] };
    }
    const row = await this.repo.insertObservation({
      source_id: o.source_id, url: o.url, fetched_at: o.fetched_at, published_at: o.published_at, content_hash: o.content_hash,
      title: o.title, snippet: o.snippet?.slice(0, 600) ?? null, candidate: o.candidate, status: "new", reason: null, event_id: null, is_demo: !!o.is_demo,
    });
    const finish = async (status: IngestOutcome["status"], reason: string | null, events: IngestOutcome["events"] = []) => {
      await this.repo.updateObservation(row.id, { status: status === "unchanged" ? "new" : (status as never), reason, event_id: events[0]?.id ?? null });
      return { status, reason: reason ?? undefined, events };
    };

    try {
      const matchText = o.candidate ? `${o.candidate.title}\n${o.candidate.artists.map((a) => a.name).join(", ")}` : `${o.title ?? ""}\n${o.text}`;
      const pf = prefilter(o.candidate ? `${matchText}\n${o.candidate.city} ${o.candidate.date ?? ""} concert` : matchText, this.matcher, this.now());
      if (!pf.pass && !o.image) {
        if (pf.whisper) return finish("whisper", await this.handleWhisper(o, pf.artists));
        this.stats.filtered++;
        return finish("filtered_out", pf.reason);
      }

      // SkillBox-style leads: a primary page exists but we can't read it → queue a grounded lookup.
      if (!o.candidate && !o.image && o.source_id === "skillbox") {
        const queue = (await this.repo.getKv<string[]>("scout:priority")) ?? [];
        await this.repo.setKv("scout:priority", [...new Set([...pf.artists.map((a) => a.artist_id), ...queue])].slice(0, 30));
        this.stats.deferred++;
        return finish("deferred", "lead queued for grounded scout");
      }

      const candidates = await this.extract(o, pf.artists);
      if (candidates.length === 0) {
        this.stats.filtered++;
        return finish("filtered_out", "no event in text");
      }

      const events: IngestOutcome["events"] = [];
      for (const [i, c0] of candidates.entries()) {
        const r = await this.processCandidate(o, c0, i, row.id, opts);
        if (r) events.push(r);
      }
      if (!events.length) {
        this.stats.rejected++;
        return finish("rejected", "failed truth/resolution checks or past date");
      }
      this.stats.merged++;
      return finish("merged", null, events);
    } catch (e) {
      this.log(`ingest error ${o.url}: ${(e as Error).message}`);
      return finish("error", (e as Error).message.slice(0, 300));
    }
  }

  /** Deterministic JSON-LD → as-is; poster → vision; text → Gemini extraction with heuristic fallback. */
  private async extract(o: ObservationInput, matches: ArtistMatch[]): Promise<{ c: Candidate; ai: boolean }[]> {
    if (o.candidate) return [{ c: o.candidate, ai: false }];
    const hints = this.artists.filter((a) => a.enabled).map((a) => a.name);
    if (o.image) {
      const r = await aiVision(this.gemini, { image: o.image, caption: o.text, today: this.today(), artistHints: hints });
      if (r.ok) return r.data.events.map((c) => ({ c, ai: true }));
      this.log(`vision fallback: ${r.reason}`);
    } else {
      const r = await aiExtract(this.gemini, { text: o.text, url: o.url, today: this.today(), artistHints: hints, priority: this.priorityFor(matches), cacheKey: o.content_hash });
      if (r.ok) return r.data.is_event_announcement ? r.data.events.map((c) => ({ c, ai: true })) : [];
      this.log(`extract fallback (${r.reason}${r.detail ? `: ${r.detail.slice(0, 160)}` : ""}) for ${o.url}`);
    }
    this.stats.fallbacks++;
    const h = heuristicExtract(o.text, this.matcher.match(o.text), this.now());
    return h ? [{ c: h, ai: false }] : [];
  }

  private async processCandidate(o: ObservationInput, x: { c: Candidate; ai: boolean }, idx: number, obsId: string, opts: { allowDemoSend?: boolean }) {
    let c = x.c;
    // 1) Truthfulness: deterministic quote check + (for AI output) a Gemini verification pass.
    let verification = null;
    if (x.ai) {
      const v = await aiVerify(this.gemini, { candidate: c, text: o.text, cacheKey: `${o.content_hash}|${idx}`, priority: "normal" });
      if (v.ok) verification = v.data;
    }
    const { candidate, report } = enforceTruth(c, o.text, verification);
    if (report.rejected) {
      this.log(`rejected (${report.reason}) ${o.url}`);
      return null;
    }
    c = candidate;
    if (report.dropped.length) this.log(`dropped unsupported fields ${report.dropped.join(",")} from ${o.url}`);

    // 2) Past shows are out of scope.
    if (c.date && c.date < this.today()) return null;
    if (!canonicalCity(c.city)) return null;

    // 3) Entity resolution: map names to followed artists, namesake/tribute guard, Gemini for uncertain cases.
    const text = `${c.title}\n${c.artists.map((a) => `${a.role === "support" ? "supported by " : ""}${a.name}`).join("\n")}`;
    const matches = this.matcher.match(text).filter((m) => !m.blocked);
    const resolved: ArtistMatch[] = [];
    for (const m of matches) {
      if (!m.needs_resolution) { resolved.push(m); continue; }
      const artist = this.artists.find((a) => a.id === m.artist_id)!;
      const r = await aiResolve(this.gemini, { artist: artist.name, genres: artist.genres, isInternational: artist.is_international, text: o.text.slice(0, 3000), cacheKey: `${o.content_hash}|${artist.id}` });
      if (r.ok && r.data.same_artist && !r.data.is_tribute_or_cover && r.data.confidence >= this.settings.confirm_threshold) resolved.push(m);
      // Offline fallback (AI unavailable): only a primary ticketing title, with music wording, that spells the artist exactly (case included).
      else if (!r.ok && o.is_primary && m.matched === artist.name && /\b(live|concert|gig|unplugged|in concert)\b/i.test(c.title)) resolved.push(m);
    }
    if (!resolved.length) return null;
    const roleOf = (m: ArtistMatch) => c.artists.find((a) => this.matcher.match(a.name).some((x) => x.artist_id === m.artist_id))?.role ?? m.role;
    const headliner_ids = resolved.filter((m) => roleOf(m) === "headliner").map((m) => m.artist_id);
    const support_ids = resolved.filter((m) => roleOf(m) === "support").map((m) => m.artist_id);

    // 4) Merge into the canonical event (dedupe + provenance + state machine + priority/urgency).
    const merged = await mergeCandidate(this.repo, {
      candidate: c, headliner_ids: headliner_ids.length ? headliner_ids : support_ids, support_ids: headliner_ids.length ? support_ids : [],
      source_id: o.source_id, url: o.url, is_primary: o.is_primary, snippet: o.snippet ?? c.title, observation_id: obsId,
      published_at: o.published_at, is_demo: !!o.is_demo,
    }, this.artists, this.opts.homeCity, this.now());
    if (merged.isNew) this.stats.newEvents++;
    await this.repo.touchArtists(resolved.map((m) => m.artist_id), "last_checked_at", this.now().toISOString());

    // 5) Alerts + reminders.
    const sent = await this.emitAlerts(merged, opts);
    await scheduleReminders(this.repo, merged.after.event, merged.after.tiers, this.now());
    return { id: merged.after.event.id, isNew: merged.isNew, alerts: sent };
  }

  async emitAlerts(m: MergeResult, opts: { allowDemoSend?: boolean } = {}, forcedFacts?: AlertFact[]): Promise<number> {
    const facts = forcedFacts ?? decideAlerts(m.before, m.after, this.now());
    if (!facts.length) return 0;
    const e = m.after.event;
    const created = [];
    for (const f of facts) {
      const a = await this.repo.insertAlertIfNew({
        event_id: e.id, type: f.type, dedupe_key: f.key, priority: alertPriority(e.priority, f.type), payload: { summary: f.summary },
        text: f.summary, is_demo: e.is_demo, held_for_quiet: false, first_public_at: e.first_public_at, first_seen_at: e.first_seen_at,
        sent_at: null,
      });
      if (a) created.push({ a, f });
    }
    if (!created.length) return 0;
    // Bundle all new facts for this event into ONE message, carried by the first alert row.
    const lead = created[0].a;
    const type = headlineType(created.map((x) => x.f));
    const rendered = await this.render(e, type, created.map((x) => x.f.summary), m.after.tiers, !!opts.allowDemoSend);
    await this.repo.updateAlert(lead.id, { type, text: rendered.text, payload: { facts: created.map((x) => x.f.summary), rendered: rendered.lines, title: rendered.title } });
    for (const x of created.slice(1)) await this.repo.updateAlert(x.a.id, { payload: { summary: x.f.summary, bundled_into: lead.id }, sent_at: this.now().toISOString() });
    const status = await deliver(this.repo, this.channels, { ...lead, type }, rendered, {
      settings: this.settings, now: this.now(), urgency: e.urgency, allowDemoSend: opts.allowDemoSend, icsUrl: `${this.opts.appBaseUrl}/api/event/${e.id}/ics`,
    });
    this.stats.alerts += created.length;
    this.log(`alert ${type} (${status}) ${rendered.title}`);
    return created.length;
  }

  async render(e: EventRow, type: Parameters<typeof renderAlert>[0]["type"], facts: string[], tiers: Awaited<ReturnType<Repo["listTiers"]>>, demo: boolean) {
    const sources = await this.repo.listEventSources([e.id]);
    const venue = e.venue_id ? (await this.repo.listVenues()).find((v) => v.id === e.venue_id) : null;
    const affinity = await bestAffinity([...e.headliner_ids, ...e.support_ids], this.artists);
    let why = defaultWhy(e, tiers, affinity, venue?.capacity_approx ?? null, this.opts.homeCity);
    if (e.priority !== "P2" && !e.is_demo) {
      const r = await aiWhy(this.gemini, {
        cacheKey: `${e.id}|${type}|${facts.join("|")}`,
        facts: { artist: artistNames(e, this.artists), affinity, city: e.city, home_city: this.opts.homeCity, when: e.start_at ? formatIst(e.start_at) : e.start_date_local, venue_capacity_approx: venue?.capacity_approx ?? null, change: facts, tiers: tiers.map((t) => ({ name: t.name_raw, availability: t.availability })) },
      });
      if (r.ok) why = r.data.line;
    }
    const others = (await this.repo.listEvents({ fromDate: this.today() })).filter((x) => x.id !== e.id && x.is_demo === e.is_demo && x.headliner_ids.some((h) => e.headliner_ids.includes(h)));
    return renderAlert({
      type, facts, event: e, tiers, sources, artists: this.artists, homeCity: this.opts.homeCity, why, appBaseUrl: this.opts.appBaseUrl,
      now: this.now(), demo, otherIndiaEvents: others.map((x) => ({ city: x.city, date: x.start_date_local })),
    });
  }

  /** Scout "signal" findings go straight to whisper classification (never alert-worthy on their own). */
  async ingestWhisper(o: ObservationInput, artistId: string): Promise<string> {
    if (await this.repo.findObservation(o.source_id, o.url, o.content_hash)) return "unchanged";
    await this.repo.insertObservation({
      source_id: o.source_id, url: o.url, fetched_at: o.fetched_at, published_at: o.published_at, content_hash: o.content_hash,
      title: o.title, snippet: o.snippet?.slice(0, 600) ?? null, candidate: null, status: "whisper", reason: null, event_id: null, is_demo: !!o.is_demo,
    });
    return this.handleWhisper(o, [{ artist_id: artistId } as ArtistMatch]);
  }

  private async handleWhisper(o: ObservationInput, matches: ArtistMatch[]): Promise<string> {
    if (!this.settings.whispers_enabled || !matches.length) return "whispers disabled";
    const artist = this.artists.find((a) => a.id === matches[0].artist_id)!;
    const r = await aiWhisper(this.gemini, { artist: artist.name, text: o.text, url: o.url, cacheKey: o.content_hash });
    if (!r.ok) return `whisper not classified (${r.reason})`; // precision first: no AI → no whisper
    const w = r.data;
    if (!w.is_signal || w.confidence < this.settings.whisper_min_confidence) return "not a signal";
    const { quoteInText } = await import("./truth");
    if (!quoteInText(w.quote, o.text)) return "signal quote not found in source";
    const ins = await this.repo.insertWhisperIfNew({
      artist_id: artist.id, kind: w.kind, summary: w.summary, url: o.url, snippet: w.quote, region: w.region, confidence: w.confidence,
      dedupe_key: sha256(`${artist.id}|${w.kind}|${w.region ?? ""}|${o.url}`), is_demo: !!o.is_demo,
    });
    if (ins) this.stats.whispers++;
    return ins ? "whisper saved" : "whisper duplicate";
  }

  /** Fire due sale-window reminders (fast lane). */
  async dispatchReminders(): Promise<number> {
    const due = await this.repo.dueReminders(this.now().toISOString());
    let n = 0;
    for (const r of due) {
      const e = await this.repo.getEvent(r.event_id);
      if (!e || e.status === "cancelled") { await this.repo.markReminderSent(r.id, this.now().toISOString()); continue; }
      // Stale reminder (more than 30 min late): mark done without spamming.
      if (Date.parse(r.fire_at) < this.now().getTime() - 30 * 60_000 && Date.parse(r.target_at) < this.now().getTime()) { await this.repo.markReminderSent(r.id, this.now().toISOString()); continue; }
      const tiers = await this.repo.listTiers([e.id]);
      const tier = tiers.find((t) => t.id === r.tier_id);
      const what = `${r.offset_label.replace("T-", "")} until ${tier?.name_raw ?? "sale"} ${r.kind === "sale_open" ? "OPENS" : "CLOSES"} (${formatIst(r.target_at)})`;
      const alert = await this.repo.insertAlertIfNew({
        event_id: e.id, type: "REMINDER", dedupe_key: `reminder|${r.dedupe_key}`, priority: e.priority === "P2" ? "P1" : e.priority, payload: { reminder: r.id },
        text: what, is_demo: e.is_demo, held_for_quiet: false, first_public_at: e.first_public_at, first_seen_at: e.first_seen_at, sent_at: null,
      });
      await this.repo.markReminderSent(r.id, this.now().toISOString());
      if (!alert) continue;
      const rendered = await this.render(e, "REMINDER", [what], tiers, false);
      await deliver(this.repo, this.channels, alert, rendered, { settings: this.settings, now: this.now(), urgency: 100, icsUrl: `${this.opts.appBaseUrl}/api/event/${e.id}/ics` });
      n++;
    }
    return n;
  }

  /** After quiet hours: send held P2 alerts as one batch digest message. */
  async flushHeld(): Promise<number> {
    const { inQuietHours } = await import("@/lib/notify/dispatch");
    if (inQuietHours(this.settings, this.now())) return 0;
    const held = (await this.repo.listAlerts({ held: true, unsent: true, limit: 50 }));
    if (!held.length) return 0;
    const lines = held.map((a) => `• ${(a.payload as { title?: string }).title ?? a.text.split("\n")[0]}`);
    const digest = await this.repo.insertAlertIfNew({
      event_id: null, type: "DIGEST", dedupe_key: `held|${held.map((h) => h.id).sort().join(",").slice(0, 200)}|${sha256(held.map((h) => h.id).join())}`, priority: "P2",
      payload: { held: held.map((h) => h.id) }, text: lines.join("\n"), is_demo: false, held_for_quiet: false, first_public_at: null, first_seen_at: null, sent_at: null,
    });
    for (const h of held) await this.repo.updateAlert(h.id, { sent_at: this.now().toISOString() });
    if (!digest) return 0;
    const title = `Overnight: ${held.length} lower-priority update(s)`;
    await deliver(this.repo, this.channels, { ...digest, priority: "P1" }, { title, lines, html: `<b>${title}</b>\n${lines.join("\n")}`, text: `${title}\n${lines.join("\n")}`, ticketUrl: null, eventUrl: `${this.opts.appBaseUrl}/alerts`, unconfirmed: false },
      { settings: this.settings, now: this.now(), urgency: 0, icsUrl: null });
    return held.length;
  }
}
