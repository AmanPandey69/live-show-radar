# Automation brief: Live Show Radar

## Pain
Karan listens 4–5 h a day and follows ~60 artists. In one year he missed four shows:
- one he heard about only when it was already sold out;
- one by an artist he never knew was touring;
- two where early-bird passes (gone in ~6 hours) had sold out before he saw the Instagram post.

The shows at risk are mid-tier international acts and rising Indian artists playing ~500-seat Bengaluru rooms.

## User
One person, Karan. He will buy the same day an announcement drops if early-bird is still open. He also wants shows outside Bengaluru, with enough notice to decide on travel.

## Outcome
Within minutes of a show first appearing on a monitored source, Karan gets one Telegram message (email as fallback) with:
- artist, venue, city, IST date/time;
- an explicit ticket-status line (e.g. "EARLY-BIRD OPEN NOW, closes …", or "Early-bird: not stated, check the link");
- the ticket link and the sources;
- "detected N minutes after first public sign";
- why it matters to him.

Reminders fire at T-24h / T-1h / T-10m before known sale windows. A daily digest proves the system is alive even when there is no news.

## Failure risks and guardrails
| Risk | Guardrails |
|---|---|
| **Missed show** | Many independent sources (District sitemap + JSON-LD, SkillBox sitemap, allevents, Bing News, Gemini grounded search). Coverage scheduler: every artist re-checked at least every 12 h, must-see every 3 h. Source-health tracking with degraded/blocked states. Daily digest + heartbeat, so silence is visible. Share-to-Radar for Instagram (never scraped). Deterministic fallback extraction so ingestion continues when Gemini is rate-limited or over budget (tested with a 429 storm). |
| **Wrong alert (wrong artist, tribute act, namesake)** | Alias regex with word boundaries. Common-word names need capitalisation + music context. Tribute/cover/"Candlelight" guard. Per-artist namesake blocks (e.g. "Phoenix Marketcity"). Gemini entity-resolution call for uncertain matches. "Wrong artist" feedback adds a block. Unconfirmed events (single non-official source) are visibly different (dashed border, "UNCONFIRMED" prefix). |
| **Hallucinated early-bird tier, price, time or deadline** | Every field must carry a verbatim quote, and code checks that the quote exists in the source text and actually contains the date, time or price. A second Gemini verification pass can veto fields. Unsupported fields become `unknown`, so the alert says "not stated". JSON-LD is parsed without AI. Known trap handled: District's `availabilityEnds` equals the show start and is *not* shown as a deadline. Deadlines without a stated time are labelled "(time not stated)". |
| **Duplicate / noisy alerts** | Canonical event fingerprint + ±1-day fuzzy merge. Alerts fire on state *transitions* with per-fact dedupe keys. Facts from one ingest are bundled into one message. P2 respects quiet hours and is batched; P0/P1 always send. |
| **Platform limits** | Vercel Hobby cron is daily-only, so 5/30-minute lanes come from external schedulers. Lease locks prevent overlapping runs. Lanes are time-boxed under `maxDuration` and resume from cursors. |
| **Etiquette / legal** | robots.txt obeyed, honest user-agent, ETag/If-Modified-Since, per-host spacing. No logins, no CAPTCHA or bot-protection bypass. BookMyShow, Ticketgenie and SortMyScene are marked blocked rather than evaded. Google News RSS is off (robots.txt). Reddit not used (robots.txt). |

## Deliberately not built
- **Instagram/X scraping:** login-walled. Covered by forwarding a screenshot to the Telegram bot.
- **Getting around BookMyShow's Cloudflare block:** we rely on search-discovered snippets instead.
- **Fares or live travel prices:** only a static, approximate travel-time table.
- **Auto-buying tickets.**
- **Bandsintown/Ticketmaster:** adapters are listed but stay disabled without consent/keys (Ticketmaster has near-zero India coverage).
- **Multi-user accounts:** Spotify Development Mode allows the owner plus a few allow-listed users; the public site is read-only.
- **Web push / PWA** (stretch).
