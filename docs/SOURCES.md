# Sources: live verification log

Tested on **2026-10-12** from a residential connection with the honest user-agent
`LiveShowRadar/0.1 (+personal concert-alert research; polite, robots-respecting)`.
Each source was hit with only a handful of requests, one second apart.
Re-run `npm run sources:check` (built in the adapters step) to refresh this table.

Rules every adapter follows:
- Obey robots.txt for `*`.
- Rate-limit per host (default 1 request per 3 s, 10 s for heavy pages).
- Send `If-None-Match` / `If-Modified-Since`.
- Never log in.
- Never solve or evade CAPTCHAs, Cloudflare challenges or 403s. A 403 or challenge marks the source `degraded` and stops polling it for 6 h.

## Summary

| # | Source | Verdict | How we use it | Cost |
|---|---|---|---|---|
| 1 | Gemini 3.8 Flash + Google Search grounding (scout) | **Works, paid tier only** | Deep lane: per-artist and India-wide queries | 5,000 grounded searches/month free on paid tier (shared by all Gemini 3+ models), then $14 per 1,000. Tokens $0.75 in / $3.75 out per 1M until 31 Dec 2026 |
| 2a | Bing News RSS (`bing.com/news/search?format=rss`) | **Works, robots-allowed** | Fast lane: per-artist and per-city news queries | Free |
| 2b | Google News RSS (`news.google.com/rss/search`) | **Works technically, but robots.txt disallows `/rss` for `*`** | **Disabled by default** (`GOOGLE_NEWS_RSS_ENABLED=false`). Your call, see "Open decision" below | Free |
| 3a | District (Zomato): event sitemap + event pages | **Works, best primary source** | Fast lane: diff sitemap with ETag → fetch new or changed event pages → parse JSON-LD | Free; sitemap ~950 KB, `304` when unchanged |
| 3b | BookMyShow | **Blocked** (Cloudflare "Sorry, you have been blocked" 403 on every page, robots.txt is fine) | `degraded`. Covered indirectly through the Gemini scout and news, which surface `in.bookmyshow.com` URLs and snippets | n/a |
| 3c | SkillBox: event sitemap | **Works (sitemap only)** | Fast lane: diff sitemap (`lastmod` has a timestamp) → artist-slug prefilter → hand the URL to the Gemini scout for details. Event pages are a client-rendered SPA with no data in the HTML | Free; 4.4 MB, ETag supported |
| 3d | Ticketgenie | **Blocked** (site is an SPA; its JSON API `scaleapi.ticketgenie.in` returns 403 to non-browser clients) | `degraded`. Discovered only via scout | n/a |
| 3e | Townscript | **Works, low value** (robots allows `*`; listing pages render client-side, with no event JSON-LD) | Not built. Mostly workshops; music events reach us via scout and allevents | n/a |
| 3f | SortMyScene | **Blocked** (Cloudflare "Just a moment…" challenge) | `degraded` | n/a |
| 3g | Paytm Insider (`insider.in`) | **Gone** (502; merged into District) | Not built | n/a |
| 3h | allevents.in: city concert pages | **Works** (robots allows; Event JSON-LD on listing pages) | Fast lane: Bengaluru + 7 metro concert listing pages | Free; ~450 KB per page, so fetched every 15 min, not every 5 |
| 4 | Artist official sites / tour pages | **Varies per artist** | Optional `tour_url` per artist in seed. Fetched only if robots allow and the page changes (hash). Many use JS widgets (no data in HTML), so the adapter records `no_data` and moves on | Free |
| 5 | Promoter and venue calendars | **Mixed** | `config/sources.yaml` lists them; only those with server-rendered HTML or JSON-LD are enabled. BIC (`bangaloreinternationalcentre.org/events`) returns 200 with no Event JSON-LD and needs Gemini extraction on hash change | Free (+1 Gemini call per change) |
| 6 | Reddit RSS (r/bangalore etc.) | **Blocked by robots.txt** (`User-agent: * Disallow: /`) | Not built | n/a |
| 7 | Share-to-Radar (web form) | **Works** | Paste a link or caption, or upload a poster → Gemini vision/extraction | Free + 1–3 Gemini calls per share |
| 8a | Bandsintown | Needs written consent + `app_id` | Adapter only, disabled unless `BANDSINTOWN_APP_ID` is set | Free with consent |
| 8b | Ticketmaster Discovery | Needs `TICKETMASTER_API_KEY` (401 without) | Adapter only, disabled unless key set. **TODO:** India coverage unverified; expected near-zero, since TM doesn't sell in India | Free tier 5,000/day |
| 9 | Songkick | API closed to new users; terms page not reachable (404) | Not built | n/a |

## Details and sample parses

### 1. Gemini scout (Interactions API)
- **Model:** `gemini-3.7-flash` is now **auto-routed to `gemini-3.8-flash`** (released 2026-09-02) per the deprecations page. Default `GEMINI_MODEL=gemini-3.8-flash`. No Flash-Lite.
- **API surface:** the Interactions API (`client.interactions.create`, `@google/genai` ≥ 2.3.0) is GA and recommended for new projects. Only the Interactions docs show *structured output combined with built-in tools*: `tools: [{type:"google_search"}]` + `response_format: {type:"text", mime_type:"application/json", schema}`. The docs label this "preview, Gemini 3 series only".
- **Citations:** `url_citation` annotations (`url`, `title`, `start_index`, `end_index`) on `model_output` text blocks; the executed queries are in the `google_search_call` step.
  - **TODO (verify with a real key):** whether citations survive when `response_format` is JSON. Fallback: the schema also asks for `source_urls`, and we keep only URLs that appear in the grounding/citation steps.
- **Free tier:** token use is free, but **Google Search grounding is not available on the free tier**. The scout lane auto-disables (status `no_grounding`) and the code-only lanes keep running.
- **Rate limits:** RPM/TPM/RPD are no longer published on the docs page; they are only shown in AI Studio. Budgets are therefore env-driven:
  - `GEMINI_DAILY_CALL_BUDGET` (default 400)
  - `GEMINI_DAILY_GROUNDED_BUDGET` (default 160, about 4,800/month, which fits inside the 5,000 free grounded searches)

### 2. Bing News RSS
`GET https://www.bing.com/news/search?q=Bengaluru+concert&format=rss` → 200, RSS 2.0 (~10 KB).
Bing's robots.txt disallows `/search` but **not** `/news/search`.
Feed terms (in the RSS `<copyright>`): results may only be used for rendering in an RSS aggregator for
*personal, non-commercial use*. That fits a single-user alert tool. To stay inside it:
- we keep only the headline, publisher URL and a short snippet as evidence, never the full feed;
- we don't redistribute the feed;
- the test fixture is a synthetic file in the same format.

### 2b. Google News RSS
`GET https://news.google.com/rss/search?q="Bengaluru"+concert&hl=en-IN&gl=IN&ceid=IN:en` → 200, 100 items, e.g.
`"Bengaluru's gig season is serving major FOMO - The Times of India" | Fri, 09 Oct 2026 18:30:00 GMT`.
But `news.google.com/robots.txt` has `User-agent: * Disallow: /` with allow-lists that do **not** include `/rss`. Per the brief's "obey robots.txt" rule it is off by default.

### 3a. District
- `robots.txt`: `Allow: /`, but disallows `/*?` (query strings), `/rss`, checkout and orders. We only fetch the sitemap and clean event URLs.
- Sitemap index `https://cdn.district.in/sitemap/sitemap-events.xml` → `event-detail-pages.xml` (5,883 URLs, `lastmod` dates, `ETag`, `Last-Modified`). It is regenerated about daily, so District gives *same-day*, not 5-minute, detection on its own. The scout and news cover the gap.
- Slugs carry artist and city: `papon-live-in-concert-bengaluru-2026-buy-tickets`, so the artist and alias prefilter runs on the slug before any page fetch.
- Sample event page JSON-LD (`/events/papon-live-in-concert-bengaluru-2026-buy-tickets`), abridged:
  ```json
  {"@type":"Event","name":"Papon Live In Concert | Bengaluru",
   "startDate":"2026-11-14T13:30:00.000Z","eventStatus":"EventScheduled",
   "location":{"name":"District Arena @ Terraform","address":"…Yelahanka…Bengaluru, Karnataka 562157"},
   "offers":{"@type":"AggregateOffer","lowPrice":1299,"highPrice":4999,"offers":[
     {"name":"Early Bird | Diamond","availability":"http://schema.org/InStock","price":4999,"validFrom":"2026-06-08T06:03:13.793Z","availabilityEnds":"2026-11-14T13:30:00.000Z"},
     {"name":"Phase 1 | Gold","availability":"http://schema.org/InStock","price":1999, "…":"…"}]}}
  ```
  → parsed deterministically, with no Gemini call: tier `early_bird`, availability `open`, price ₹4,999, evidence = the offer name.
  **Truthfulness note:** `availabilityEnds` equals the show start for every tier, so it is **not** an early-bird deadline and must not be shown as one. A fixture and test cover this.
- Terms of use: general T&C page not found (`/terms-and-conditions` → 404). **TODO for owner:** review District's terms. We fetch at most one event page per 3 s and only new or changed URLs.

### 3b. BookMyShow
`in.bookmyshow.com/robots.txt` → 200 and permits `/explore/*` for `*`, but every page returns Cloudflare 403 "Sorry, you have been blocked". We do **not** retry with browser headers or headless browsers.

### 3c. SkillBox
`https://www.skillboxes.com/media/sitemap/sitemap-event.xml` → 25,672 URLs with timestamps; 83 changed in the last 3 days, e.g.
`/events/sunfire-festival-sbuiqyrq  2026-10-11T17:18:00+05:30`. The ETag lets unchanged polls cost one `304`. Event pages are an SPA shell (`<title>SkillBox - Everything live!`, no event data), so matched slugs go to the scout.

### 3h. allevents.in
`https://allevents.in/bangalore/concerts` → Event JSON-LD, e.g.
`RAGHU DIXIT LIVE IN CONCERT | 2026-10-24 | Orion Mall, Rajajinagar: Bengaluru`,
`Sonu Nigam - The Revolution India Tour | 2026-10-24 | Bhartiya Mall Of Bengaluru`.
It is an aggregator, so it counts as **secondary** for corroboration. Terms page not found at `/pages/terms` (**TODO for owner**).

## Open decision
Google News RSS is the brief's suggested free news source, but its robots.txt disallows `/rss`. Options:
1. (Default) Keep it off and use Bing News RSS, which is robots-allowed.
2. Treat it as a user-subscribed feed (like a feed reader) and enable `GOOGLE_NEWS_RSS_ENABLED=true` at a low rate (each query at most once per 30 min).
