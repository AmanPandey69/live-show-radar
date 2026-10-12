# Live Show Radar: Components Map

**In one line:** schedulers wake the app → it reads ticket and news sites for Karan's artists → Gemini Flash pulls out the show details with quotes → plain-code rules check every fact, remove duplicates and set priority → **one email when a show is announced**, and every later update goes to the in-app 🔔 bell.

![Live Show Radar components map](components-map.png)

Rows are the actors (Karan, Scheduler, Sources, System, AI Model, Services, Karan); columns are Trigger → Input → Context → Processing → AI → Output. Vector version: [`components-map.svg`](components-map.svg).

| Layer | What it is | Example |
|---|---|---|
| **Trigger** | GitHub Actions every 5 min (quick scan) and every 30 min (Google Search sweep); Vercel Cron once a day (full sweep + digest); Karan using Share-to-Radar; admin "Scan now" / "Simulate announcement" | Vercel's free plan only allows a daily cron, so the frequent runs come from GitHub Actions |
| **Input** | Karan's artists (Spotify sync, or the 60-artist seed list / CSV import); District and SkillBox sitemaps + event pages; allevents city pages; Bing News; Google Search results; links, captions and poster screenshots shared by Karan | District event pages list every ticket tier, price and the poster |
| **Context** | Must-see / like / casual tiers, artist aliases, namesake and tribute blocks, venue sizes, Bengaluru-first rules, quiet hours, past feedback, and Neon's memory of past shows, sources and alerts | "Phoenix Marketcity" is a mall, not the band Phoenix |
| **Processing** | Skip unchanged pages → keep only followed artists + Indian cities → truth check (every fact must be quoted from the source) → merge duplicates across sites → decide what changed → priority P0/P1/P2 | Same show on 2 sites = 1 event with 2 sources |
| **AI** (Gemini Flash only) | Google Search scout · extract show + ticket tiers · read posters · second-pass verify · same-artist check · whisper signals · one "why it matters" line | `google/gemini-3.8-flash` via OpenRouter, on Google's own servers |
| **Output** | **One email per newly announced show** (Resend) with venue, IST date, early-bird status and deadline, ticket link; every later update in the 🔔 notification bell; the poster radar website with a city dropdown (Bengaluru default); event pages with quoted evidence and `.ics` | "EARLY-BIRD OPEN NOW, deadline not stated" |

**Kept out of AI on purpose:** priority, dedupe, dates and times, and every price, time and deadline check are plain code, so an email can't contain an invented fact.
