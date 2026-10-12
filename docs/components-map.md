# Live Show Radar: Components Map

Live Show Radar watches the India concert calendar for every artist Karan follows (Bengaluru first), and alerts him on Telegram/email the moment a show or an early-bird window appears. Every ticket fact is quoted, labelled inferred, or marked "not stated".

```mermaid
flowchart LR
  subgraph T[Triggers]
    T1[GitHub Actions every 5 min: fast lane]
    T2[GitHub Actions every 30 min: deep lane]
    T3[Vercel Cron daily 03:30 UTC: daily lane]
    T4[Telegram Share-to-Radar]
    T5[Admin: Scan now / Simulate]
    T6[Spotify sync: OAuth PKCE, daily]
  end
  subgraph I[Inputs]
    I1[Followed artists: Spotify / seed / CSV / URLs]
    I2[District sitemap + event JSON-LD]
    I3[SkillBox sitemap]
    I4[allevents.in city pages]
    I5[Bing News RSS]
    I6[Google Search via Gemini grounding]
    I7[Forwarded posters, links, captions]
  end
  subgraph P[Processing]
    P1[Polite fetch: robots, ETag, per-host rate limit]
    P2[Content hash: unchanged → skip]
    P3[Deterministic pre-filter: alias regex, India cities, dates]
    P4[Extraction: JSON-LD parser or Gemini]
    P5[Truth gate: quotes must exist and support each field]
    P6[Entity resolution + namesake/tribute guard]
    P7[Dedupe + merge with provenance + conflicts]
    P8[Corroboration: Rumoured / Unconfirmed / Confirmed]
    P9[State machine + alert facts with dedupe keys]
    P10[Priority P0/P1/P2 + urgency score]
    P11[Reminder scheduler T-24h/1h/10m]
  end
  subgraph AI[Gemini Flash: google/gemini-3.8-flash via OpenRouter, Google infra only]
    A1[Scout: grounded search → JSON + citations]
    A2[Extract: text → Event JSON]
    A3[Vision: poster → Event JSON]
    A4[Verify: second pass, quote evidence]
    A5[Resolve: same artist? tribute? support?]
    A6[Whisper classifier]
    A7[Why-it-matters line]
  end
  subgraph O[Outputs]
    O1[Telegram alert + buttons]
    O2[Email via Resend: fallback]
    O3[.ics + Google Calendar link]
    O4[Public radar dashboard]
    O5[Daily digest + heartbeat]
    O6[Health + latency ledger]
  end
  DB[(Neon Postgres: events, tiers, sources, alerts, reminders, usage)]
  T1 & T2 & T3 & T5 --> P1
  T4 --> P4
  T6 --> I1
  I2 & I3 & I4 & I5 --> P1 --> P2 --> P3 --> P4
  I6 --> A1 --> P3
  I7 --> A3
  P4 --> A2
  P4 --> P5
  A2 --> P5
  A3 --> P5
  A4 --> P5
  P5 --> P6 --> P7 --> P8 --> P9 --> P10 --> O1
  A5 --> P6
  P3 -. whisper wording .-> A6 --> O4
  P10 --> P11 --> O1
  O1 -. failure .-> O2
  A7 --> O1
  P7 --> DB --> O4 & O6
  T3 --> O5
```

| Layer | Components | Where in code |
|---|---|---|
| **Trigger** | 5-minute fast lane and 30-minute deep lane from external schedulers (GitHub Actions `scan.yml`; cron-job.org/QStash as redundancy), daily Vercel Cron (03:30 UTC ≈ 09:00 IST), Telegram share (webhook), admin **Scan now** / **Simulate announcement**, Spotify sync (OAuth PKCE, daily re-sync) | `app/api/cron/scan`, `app/api/cron/daily`, `app/api/telegram/webhook`, `app/api/admin/*`, `lib/scheduler/*` |
| **Input** | Followed-artist list (Spotify `/me/following` + `/me/top/artists`; seed list; CSV/URL/name import); ticketing pages (District sitemap + event JSON-LD, SkillBox sitemap; BookMyShow/Ticketgenie are blocked and only reach us via search); aggregator pages (allevents.in); news RSS (Bing News; Google News off: robots.txt); Google Search results via Gemini grounding; forwarded posters, links and captions | `lib/sources/adapters/*`, `lib/spotify/spotify.ts` |
| **Context** | Affinity tiers (must-see / like / casual + manual star), aliases (stage names, "The" prefix, transliterations), namesake/tribute blocks, venue capacities (approximate), Bengaluru-first priority rules and quiet hours, dedupe memory (fingerprints, content hashes, ETags, sitemap cursors), feedback history (affinity changes, blocks, confidence threshold) | `artists`, `artist_aliases`, `artist_blocks`, `venues`, `settings`, `observations`, `http_cache`, `feedback` tables |
| **Processing** | Change detection (ETag / content hash), deterministic pre-filters, extraction (JSON-LD parser first, Gemini otherwise, heuristic fallback), truthfulness gate, entity resolution + namesake/tribute guard, corroboration (Confirmed needs 1 primary or 2 independent sources), dedupe/merge (artists + city + date ±1 day + fuzzy venue) with conflicts kept, event state machine, alert-fact transitions with dedupe keys, priority P0/P1/P2 + urgency score, reminder scheduling | `lib/text/*`, `lib/pipeline/*`, `lib/domain/rules.ts`, `lib/alerts/*` |
| **AI** (Gemini Flash only) | 1. Scout: grounded search → structured candidates + source URLs · 2. Extraction: page text → Event JSON · 3. Vision: posters/screenshots → Event JSON · 4. Entity resolution: same artist / tribute / support · 5. Verification: second pass quotes evidence, unsupported fields rejected · 6. Whisper classification · 7. "Why it matters" line. Model `google/gemini-3.8-flash` via OpenRouter, `provider.only = google-vertex / google-ai-studio`, no fallbacks; zod-validated, retry once, 429 backoff + cooldown, daily budget with priority reserve, content-hash cache, `gemini_usage` log | `lib/ai/gemini.ts`, `lib/ai/tasks.ts` |
| **Output** | Telegram alerts (inline buttons: Open tickets, Going, Maybe, Not interested, Wrong info, Wrong artist, Add to calendar, Remind me), email via Resend (urgent alerts + fallback), sale-window reminders, `.ics` with T-24h/1h/10m alarms + Google Calendar link, public radar dashboard, daily digest ("Checked N artists across M sources…"), health page with source status, Gemini budget, coverage and the latency ledger (median/p90) | `lib/notify/*`, `lib/alerts/ics.ts`, `app/*` |

**Not AI on purpose:** the alert text (except the one "why" line), priority, dedupe, state machine, dates and timezones, and every price, time and deadline check. All of these are deterministic, so nothing in an alert can be invented.
