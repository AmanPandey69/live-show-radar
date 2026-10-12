# Live Show Radar: Components Map

**In one line:** schedulers wake the app → it reads ticket and news sites for Karan's Spotify artists → Gemini Flash pulls out the show details → rules check the facts and remove duplicates → Telegram/email alert Karan once per new fact.

Colors: grey = person, purple = outside service, green = our app on Vercel.

```mermaid
flowchart TB
  SP[Spotify<br/>Karan's followed artists]:::ext
  SC[Schedulers<br/>every 5 / 30 min + daily]:::ext
  SRC[Ticket & news sites<br/>District, SkillBox, news]:::ext
  subgraph APP[Live Show Radar app on Vercel]
    SCAN[Scan API<br/>fetch, skip unchanged]:::app
    AI[Gemini Flash<br/>search, extract, verify]:::app
    RULES[Rules engine<br/>truth check, dedupe, priority]:::app
    DB[(Neon database<br/>artists, shows, alerts)]:::app
    ALERT[Alert engine<br/>once per fact, reminders]:::app
    DASH[Dashboard<br/>radar, health, map]:::app
  end
  TG[Telegram<br/>alerts, buttons, share]:::ext
  EM[Resend email<br/>backup channel]:::ext
  K[Karan<br/>buys tickets, feedback]:::person
  SC --> SCAN
  SRC --> SCAN
  SP --> RULES
  SCAN --> AI --> RULES --> DB --> ALERT --> DASH
  ALERT --> TG
  ALERT --> EM --> K
  TG --> K
  K --> DASH
  classDef ext fill:#3a3486,stroke:#6d63d9,color:#ebe8ff
  classDef app fill:#1f4d3c,stroke:#3f9d76,color:#dcf6e9
  classDef person fill:#3d3b36,stroke:#6e6a61,color:#f2efe8
```

| Layer | What it is | Example |
|---|---|---|
| **Trigger** | GitHub Actions every 5 min (quick check) and every 30 min (Google Search sweep); Vercel Cron once a day; Karan forwarding a post to the Telegram bot; admin "Scan now" | Vercel's free plan only allows a daily cron, so the frequent runs come from GitHub Actions |
| **Input** | Followed artists (Spotify, or a 60-artist seed list); District and SkillBox sitemaps; allevents pages; Bing News; Google Search results; forwarded posters and links | District event pages list every ticket tier and price |
| **Context** | Must-see / like / casual tiers, artist aliases, namesake blocks, venue sizes, Bengaluru-first rules, quiet hours, past feedback | "Phoenix Marketcity" is a mall, not the band Phoenix |
| **Processing** | Skip unchanged pages → name and city filter → truth check (every fact must be quoted) → merge duplicates → decide what's new → priority P0/P1/P2 → reminders | Same show from 2 sites = 1 event with 2 sources |
| **AI** (Gemini Flash only) | Google Search scout · extract show details · read posters · second-pass verify · same-artist check · whisper signals · one "why it matters" line | `google/gemini-3.8-flash`, via OpenRouter on Google's own servers |
| **Output** | Telegram alert with buttons, email backup, reminders (24 h / 1 h / 10 min), .ics calendar file, public dashboard, daily "what we checked" digest | "EARLY-BIRD OPEN NOW, deadline not stated" |

**Kept out of AI on purpose:** priority, dedupe, dates and times, and every price, time and deadline check are plain code, so an alert can't contain an invented fact.
