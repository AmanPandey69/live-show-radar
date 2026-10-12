# Viva cheat-sheet: Live Show Radar

## 30-second pitch
Karan follows ~60 artists and kept missing shows, because early-bird tickets sell out in ~6 hours. Live Show Radar checks Indian ticketing sites, news and Google Search for every artist he follows. When a show appears (Bengaluru first, rest of India too) it sends one Telegram alert with:
- artist, venue, city and IST date;
- a clear ticket line such as "EARLY-BIRD OPEN NOW" or "Early-bird: not stated";
- the ticket link and the sources;
- how fast we detected it.

**The rule that matters most:** it never invents a price, time or deadline. Every fact is quoted from a source, or the alert says "not stated".

## The flow in one breath
**Scheduler → fetch sources → skip unchanged pages → cheap name/city filter → extract the event → truth check → is it really this artist? → merge duplicates → decide what's new → alert + reminders → dashboard.**

## The 6 parts (matches the Components Map)
| Part | What it is here | One-liner to say |
|---|---|---|
| Trigger | GitHub Actions every 5 min / 30 min, Vercel Cron daily, Telegram share, admin buttons | "Vercel's free cron only runs once a day, so the frequent runs come from GitHub Actions calling a protected URL." |
| Input | Spotify artists (or a 60-artist seed list), District, SkillBox, allevents, Bing News, Google Search via Gemini | "BookMyShow blocks bots with Cloudflare, so we don't scrape it; we find it through search instead." |
| Context | Affinity tiers (must-see/like/casual), aliases, namesake blocks, venue sizes, quiet hours, past feedback | "Context decides priority and catches fake matches like 'Coldplay tribute night'." |
| Processing | Pre-filter, extraction, truth gate, dedupe, state machine, priority, reminders | "Most of the logic is plain code, so it's testable and can't hallucinate." |
| AI | Gemini Flash only (`google/gemini-3.8-flash` via OpenRouter, Google servers only): search, extract, read posters, verify, check artist identity, classify whispers, write the "why" line | "AI only reads and checks; it never decides priority or writes the ticket facts." |
| Output | Telegram (+ buttons), email fallback, .ics calendar, dashboard, daily digest, health page | "Even 'no news' is reported daily, so silence means checked, not broken." |

## Likely questions, short answers
- **How do you stop hallucinated early-bird info?** Every field carries a verbatim quote. Code checks the quote exists in the page *and* contains that date, time or price. If not, the field becomes "not stated". A second Gemini call can also veto fields.
- **Real example of a trap you handled?** District lists a closing time on every ticket tier that equals the show start time. That is not an early-bird deadline, so we ignore it. There's a test for it.
- **Tribute acts and same-name artists?** Word-boundary matching, a tribute/cover/"Candlelight" filter, per-artist blocks ("Phoenix Marketcity" is not the band Phoenix), and a Gemini identity check when unsure. "Wrong artist" feedback adds a block.
- **Duplicates across sources?** Same artist + same city + date within a day + similar venue = one event. Every source is kept as evidence. Alerts fire only when something *changes*, each with a unique key, so the same fact is never sent twice.
- **Confirmed vs unconfirmed?** Confirmed needs one official source (ticketing site) or two independent sites. Unconfirmed alerts look visibly different (dashed border, "UNCONFIRMED").
- **Priorities?** P0 = Bengaluru AND (early-bird OR must-see artist). P1 = other-city early-bird, or any Bengaluru show. P2 = rest. P0/P1 ignore quiet hours because early-bird sells out in hours.
- **What if Gemini fails or hits its limit?** It retries with backoff, then pauses AI for 10 min, and ingestion continues with plain-code parsing. There's a test that simulates a storm of 429 errors.
- **Cost control?** Unchanged pages are skipped (ETag + content hash); a cheap name filter runs before any AI call; a daily call budget reserves capacity for must-see artists; AI answers are cached.
- **Why Neon and not Supabase?** Serverless Postgres that plugs straight into Vercel. One `DATABASE_URL`, no extra auth layer.
- **Why OpenRouter?** It was the only Gemini access available. Every request is pinned to Google's own servers (`provider.only = google-vertex / google-ai-studio`), and the code refuses any non-Google model.
- **Is scraping allowed?** We obey robots.txt, use an honest user-agent, rate-limit per site and never log in or bypass blocks. Blocked sites are marked "degraded" on the Health page. Google News is off because its robots.txt disallows the feed.
- **Detection latency?** Stored per alert (first public sign → alert sent). Median and p90 are on `/health`; the target is under 10 minutes.
- **What did you deliberately NOT build?** Instagram scraping (login-walled: forward a screenshot to the bot instead), getting around BookMyShow's block, live travel fares, auto-buying tickets.

## Demo script (≈2 min, for the 5% video)
1. Open the **Radar** page: Bengaluru first, real shows (e.g. Papon @ District Arena, 14 Nov) with status chips and the early-bird line.
2. Click a show: quoted evidence per tier, sources, travel card for other cities, **.ics** download.
3. **Health** page: sources ok/blocked, Gemini budget, latency, scan runs.
4. **Settings** (admin) → **Simulate announcement** → the [DEMO] alert arrives on Telegram with buttons.
5. **Components Map** (`docs/components-map.svg`): walk the diagram top to bottom.
6. GitHub: show `tests/` and that CI fails if any non-Gemini AI SDK appears.
