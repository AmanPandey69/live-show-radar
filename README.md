# Live Show Radar

Live Show Radar sends concert and early-bird alerts for the ~60 artists Karan follows. It covers all of India, with Bengaluru first.

- **Live:** https://liveshowradar-blr.vercel.app (public, read-only)
- **Components Map:** [`docs/components-map.md`](docs/components-map.md) (image: [`docs/components-map.png`](docs/components-map.png))
- **Automation brief:** [`docs/automation-brief.md`](docs/automation-brief.md)
- **Source verification log:** [`docs/SOURCES.md`](docs/SOURCES.md)

**Stack:** Next.js 16 (App Router) on Vercel · Neon Postgres · **Gemini Flash only** (`google/gemini-3.8-flash`, called through OpenRouter and pinned to Google's own infrastructure).

## What it does
1. **Tracks the artist list.** It syncs followed artists from Spotify (OAuth PKCE, owner only). If Spotify isn't connected it uses a 60-artist seed list or CSV/URL/name import. Each artist gets an affinity tier (must-see / like / casual, with a manual ★ override).
2. **Watches sources.** It monitors ticketing, aggregator, news and Google Search sources. A cheap deterministic pre-filter runs first, and Gemini only sees changed content.
3. **Extracts events with evidence.** Every fact must carry a verbatim quote, and code checks that the quote exists and supports the value. A second Gemini pass verifies AI extractions. Unsupported fields become "not stated".
4. **Resolves artists and merges duplicates.** A namesake/tribute guard rejects lookalikes. Mentions of the same show merge into one canonical event (artists + city + date ±1 day + fuzzy venue), with provenance and conflicts kept.
5. **Sends alerts once per fact.** Alert types: NEW_SHOW, EARLY_BIRD_OPEN/IMMINENT/CLOSING, PRESALE, CHANGED, CANCELLED/POSTPONED, SOLD_OUT, UPDATE.
   - **P0** = Bengaluru AND (early-bird OR must-see).
   - **P1** = other-city early-bird, or any Bengaluru show.
   - **P2** = everything else; only P2 respects quiet hours.
6. **Delivers alerts by email.** Email via Resend (artist, venue, IST date, ticket-status line, ticket link, sources, detection latency, "why it matters", .ics link), reminders at T-24h/T-1h/T-10m, `.ics` files, a daily digest, an in-app alert log, and the trust dashboard.

## Setup
```bash
npm ci
cp .env.example .env.local      # fill in values locally, or: npx vercel env pull .env.local
npm run db:migrate              # applies db/migrations/*.sql to DATABASE_URL (Neon)
npm test                        # 86 tests, all in mock mode (no keys needed)
npm run scan:once               # REAL live scan → seeds artists/demo if empty, populates the DB
npm run dev
```
With `MOCK_MODE=1` (or no keys) everything runs on an in-memory store with a mock notifier and no AI calls.

### Accounts and keys (set in Vercel → Settings → Environment Variables)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon. Add via Vercel → Storage → Neon; it is set automatically |
| `OPENROUTER_API_KEY` | AI gateway. Google models only; each request carries `provider: {only: ["google-vertex","google-ai-studio"], allow_fallbacks: false}`. `GEMINI_API_KEY` is an optional direct alternative |
| `GEMINI_MODEL` | Default `google/gemini-3.8-flash`. Google's deprecations page says `gemini-3.7-flash` is auto-routed to 3.8. Never Flash-Lite |
| `GEMINI_DAILY_CALL_BUDGET`, `GEMINI_DAILY_GROUNDED_BUDGET` | Daily caps (IST day) with a priority reserve: must-see work can use 100%, normal 85%, low 60% |
| `CRON_SECRET` | Bearer token for `/api/cron/*` (Vercel Cron sends it automatically) |
| `ADMIN_PASSWORD` | `/settings`, Scan now, Simulate |
| `RESEND_API_KEY`, `FROM_EMAIL`, `ALERT_EMAIL` | **Alert channel.** `FROM_EMAIL` must be on a domain verified in Resend; `ALERT_EMAIL` is Karan's inbox |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | Spotify sync. Tokens are stored AES-256-GCM encrypted. Redirect URI: `https://liveshowradar-blr.vercel.app/api/spotify/callback` |
| `APP_BASE_URL`, `HOME_CITY` | `https://liveshowradar-blr.vercel.app`, `Bengaluru` |

## How each source behaves
Tested live on 2026-10-12; details in `docs/SOURCES.md`.

| Source | Behaviour |
|---|---|
| **District** (Zomato, primary) | Sitemap with ETag → artist-slug pre-filter → event page JSON-LD, parsed deterministically with named tiers and prices. The sitemap refreshes about daily. |
| **SkillBox** (primary) | Sitemap only (the pages are a JS app). Matching slugs queue an immediate grounded scout lookup. |
| **allevents.in** (aggregator, secondary) | City concert pages with Event JSON-LD. |
| **Bing News RSS** | Per-artist and per-city queries in rotation; robots-allowed; personal-use terms. |
| **Gemini scout** | Grounded Google Search (OpenRouter web plugin, `engine: native`). Findings are *leads*: they pass the same extraction and truth gate and stay **Unconfirmed** until corroborated. |
| **Share-to-Radar** | `/settings` form: paste a ticket link or caption, or upload a poster screenshot (Gemini vision). Instagram/X links are never fetched; upload a screenshot instead. |
| **Blocked / off** | BookMyShow, SortMyScene (Cloudflare), Ticketgenie (API 403): marked blocked, reached only through search. Google News RSS (robots.txt disallows `/rss`). Reddit (robots.txt). Bandsintown / Ticketmaster: optional adapters, disabled without consent/keys. |

## Scheduling: what runs when, and why
Vercel Hobby cron can run **at most once a day** (±59 min), and a more frequent schedule fails the deploy. Real-time detection therefore comes from external schedulers:

| Lane | Trigger | Work |
|---|---|---|
| **Fast**, every 5 min | `.github/workflows/scan.yml` → `POST /api/cron/scan?lane=fast` with `Authorization: Bearer $CRON_SECRET` | sitemaps, listings, news RSS, reminder dispatcher, quiet-hour flush |
| **Deep**, every 30 min | same workflow → `?lane=deep` | grounded scout over artists ordered by priority × staleness (must-see ≤3 h, others ≤12 h) |
| **Daily**, 03:30 UTC ≈ 09:00 IST | `vercel.json` cron → `/api/cron/daily` | Spotify re-sync, full sweep, digest + heartbeat, pruning |

- Every lane is idempotent, protected by a DB lease lock, time-boxed under `maxDuration` (300 s), and resumes from cursors stored in the DB.
- **GitHub Actions setup:** repo → Settings → Secrets → Actions: add `APP_BASE_URL` (`https://liveshowradar-blr.vercel.app`) and `CRON_SECRET` (same value as in Vercel).
- GitHub schedules are best-effort: runs can be delayed (worst at the top of the hour), and on public repos they are disabled after 60 days without activity.
- **Redundancy:** create two jobs at [cron-job.org](https://cron-job.org) (or Crontap / Upstash QStash schedules) that POST the same two URLs with header `Authorization: Bearer <CRON_SECRET>`. The lease lock makes duplicate triggers harmless.
- Admin **Scan now** in `/settings`. Health JSON at `GET /api/health`.

## Demo
- `data/seed/demo_events.json`: clearly fake **SAMPLE** events (`is_demo=true`). They never send real email.
- **Simulate announcement** (`/settings`): injects a demo Bengaluru show with an open early-bird tier for a followed artist and runs the **real** pipeline end to end, sending a message labelled **[DEMO]**.

## Tests
`npm test` covers:
- alias, namesake and tribute matching (including common-word names);
- dedupe across sources and conflicts;
- early-bird phrasings ("Early Bird till 15th Nov", "Phase 1", "Tier 1", "limited early access", "presale for cardholders", "opens Saturday 10am");
- state machine and alert dedupe keys; reminder scheduling;
- IST/UTC and Indian date formats; the truthfulness gate;
- fixture replay of real District/allevents snapshots;
- a Gemini 429 storm (ingestion continues on deterministic fallback);
- the **Gemini-only guard**: CI fails if any non-Gemini AI SDK, endpoint or key appears (`npm run check:no-anthropic`).

## Known limits
- District's sitemap refreshes about daily, and GitHub cron can lag. Sub-10-minute detection relies on the 5-minute news/listing lane and the 30-minute scout. The latency ledger on `/health` reports the actual median and p90.
- Instagram-first announcements are only caught when another source picks them up or Karan forwards the post.
- Venue capacities are rough estimates and labelled approximate. The travel table is static and approximate, with no fares.
- Spotify Development Mode allows the owner plus up to 5 allow-listed users, so the public site never asks visitors to log in.
- District and allevents terms-of-use pages could not be located; we fetch only public pages, slowly, with an honest user-agent.
