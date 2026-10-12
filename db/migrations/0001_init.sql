-- Live Show Radar: initial schema (Neon Postgres).
-- Applied by `npm run db:migrate` (scripts/migrate.ts). Safe to re-run (IF NOT EXISTS everywhere).
-- All timestamps are UTC (timestamptz). The UI renders them in Asia/Kolkata.
-- Only server code holds DATABASE_URL; nothing is exposed to the browser.

create extension if not exists pgcrypto;

-- ───────────────────────── artists ─────────────────────────
create table if not exists artists (
  id                   uuid primary key default gen_random_uuid(),
  spotify_id           text unique,
  name                 text not null,
  genres               text[] not null default '{}',
  is_international     boolean not null default false,
  affinity             text not null default 'like' check (affinity in ('must_see','like','casual')),
  affinity_override    text check (affinity_override in ('must_see','like','casual')),
  top_rank             int,                       -- position in Spotify top artists, if known
  is_followed          boolean not null default true,
  enabled              boolean not null default true,
  tour_url             text,                      -- optional official tour page
  origin               text not null default 'seed' check (origin in ('spotify','seed','manual','csv','url')),
  last_checked_at      timestamptz,               -- any lane touched this artist
  last_deep_checked_at timestamptz,               -- grounded scout covered this artist
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists artist_aliases (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references artists(id) on delete cascade,
  alias      text not null,
  kind       text not null default 'manual' check (kind in ('canonical','stage','the_prefix','transliteration','manual','feedback')),
  created_at timestamptz not null default now()
);
create unique index if not exists artist_aliases_uniq on artist_aliases (artist_id, lower(alias));

-- Lookalike blocks: tribute nights, unrelated namesakes. Added by rules and by "Wrong artist" feedback.
create table if not exists artist_blocks (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid references artists(id) on delete cascade,  -- null = global block (e.g. "tribute")
  pattern    text not null,                                   -- case-insensitive substring
  reason     text not null check (reason in ('tribute','namesake','feedback','rule')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── venues ─────────────────────────
create table if not exists venues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  aliases         text[] not null default '{}',
  city            text not null,
  capacity_approx int,                -- APPROXIMATE, always labelled as such in UI
  capacity_source text,
  created_at      timestamptz not null default now()
);
create unique index if not exists venues_name_city on venues (lower(name), lower(city));

-- ───────────────────────── events ─────────────────────────
create table if not exists events (
  id                 uuid primary key default gen_random_uuid(),
  fingerprint        text not null,
  title              text not null,
  headliner_ids      uuid[] not null default '{}',
  support_ids        uuid[] not null default '{}',
  is_festival        boolean not null default false,
  festival_name      text,
  venue_id           uuid references venues(id),
  venue_name_raw     text,
  city               text not null,
  start_at           timestamptz,           -- UTC; null when only the date is known
  start_date_local   text,                  -- IST calendar date 'YYYY-MM-DD' (text: avoids driver TZ shifts)
  start_local        text,                  -- display string as stated by source, e.g. "Sat 14 Nov, 7:00 PM"
  doors_at           timestamptz,
  status             text not null default 'announced'
                     check (status in ('rumoured','announced','presale','early_bird','general_sale','sold_out','postponed','cancelled')),
  confidence         text not null default 'unconfirmed' check (confidence in ('rumoured','unconfirmed','confirmed')),
  ticket_url         text,
  tour_other_cities  text[] not null default '{}',
  bengaluru_note     jsonb,                 -- {text, url, snippet} only when a source says so
  conflicts          jsonb not null default '[]',
  urgency            int not null default 0,
  priority           text not null default 'P2' check (priority in ('P0','P1','P2')),
  first_seen_at      timestamptz not null default now(),
  first_public_at    timestamptz,           -- earliest source_published_at
  first_source_id    text,                  -- which source reported it first
  last_changed_at    timestamptz not null default now(),
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now()
);
create unique index if not exists events_fingerprint on events (fingerprint);
create index if not exists events_start on events (start_date_local);
create index if not exists events_city on events (city);

-- Provenance: every source that mentioned an event.
create table if not exists event_sources (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  observation_id  uuid,
  source_id       text not null,
  url             text not null,
  is_primary      boolean not null default false,   -- ticketing / promoter / venue / artist official
  snippet         text not null,                    -- evidence (required)
  published_at    timestamptz,
  first_seen_at   timestamptz not null default now()
);
create unique index if not exists event_sources_uniq on event_sources (event_id, url);

create table if not exists ticket_tiers (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  tier_type         text not null check (tier_type in ('early_bird','phase_1','presale_card','presale_membership','general','vip')),
  name_raw          text not null,
  price_inr_min     int,
  price_inr_max     int,
  sale_start_at     timestamptz,
  sale_end_at       timestamptz,
  quantity_note     text,                 -- e.g. "limited", "first 100"
  availability      text not null default 'unknown' check (availability in ('open','upcoming','closed','sold_out','unknown')),
  source_url        text,
  evidence_snippet  text not null,
  field_confidence  text not null default 'confirmed' check (field_confidence in ('confirmed','inferred','unknown')),
  updated_at        timestamptz not null default now()
);
create unique index if not exists ticket_tiers_uniq on ticket_tiers (event_id, tier_type, lower(name_raw));

-- ───────────────────────── ingestion ─────────────────────────
create table if not exists sources (
  id          text primary key,             -- e.g. 'district', 'bing-news', 'gemini-scout'
  name        text not null,
  kind        text not null,                -- ticketing | news | search | official | promoter | venue | share | api
  is_primary  boolean not null default false,
  enabled     boolean not null default true,
  config      jsonb not null default '{}'
);

create table if not exists source_health (
  source_id            text primary key references sources(id) on delete cascade,
  status               text not null default 'ok' check (status in ('ok','degraded','blocked','disabled','no_data','no_grounding')),
  last_run_at          timestamptz,
  last_ok_at           timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  consecutive_failures int not null default 0,
  degraded_until       timestamptz,
  items_last_run       int not null default 0
);

-- Conditional-GET cache per URL.
create table if not exists http_cache (
  url            text primary key,
  etag           text,
  last_modified  text,
  content_hash   text,
  fetched_at     timestamptz not null default now()
);

create table if not exists observations (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null,
  url           text not null,
  fetched_at    timestamptz not null default now(),
  published_at  timestamptz,
  content_hash  text not null,
  title         text,
  snippet       text,
  candidate     jsonb,
  status        text not null default 'new' check (status in ('new','filtered_out','extracted','rejected','merged','whisper','error','deferred')),
  reason        text,
  event_id      uuid references events(id) on delete set null,
  is_demo       boolean not null default false
);
create unique index if not exists observations_uniq on observations (source_id, url, content_hash);
create index if not exists observations_status on observations (status);

create table if not exists whispers (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid references artists(id) on delete cascade,
  kind        text not null check (kind in ('nearby_dates','promoter_teaser','india_soon','coming_soon_page','other')),
  summary     text not null,
  url         text not null,
  snippet     text not null,
  region      text,
  confidence  real not null,
  dedupe_key  text not null unique,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ───────────────────────── alerts & delivery ─────────────────────────
create table if not exists alerts (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid references events(id) on delete cascade,
  type             text not null check (type in ('NEW_SHOW','EARLY_BIRD_OPEN','EARLY_BIRD_IMMINENT','EARLY_BIRD_CLOSING','PRESALE','CHANGED','CANCELLED','POSTPONED','SOLD_OUT','UPDATE','REMINDER','DIGEST')),
  dedupe_key       text not null unique,
  priority         text not null check (priority in ('P0','P1','P2')),
  payload          jsonb not null,
  text             text not null,
  is_demo          boolean not null default false,
  held_for_quiet   boolean not null default false,
  first_public_at  timestamptz,      -- earliest public sign (latency ledger)
  first_seen_at    timestamptz,      -- when we first observed it
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index if not exists alerts_created on alerts (created_at desc);

create table if not exists notification_deliveries (
  id           uuid primary key default gen_random_uuid(),
  alert_id     uuid references alerts(id) on delete cascade,
  channel      text not null check (channel in ('telegram','email','inapp','mock')),
  status       text not null check (status in ('sent','failed','skipped','mock')),
  attempt      int not null default 1,
  error        text,
  external_id  text,
  created_at   timestamptz not null default now()
);

create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  tier_id     uuid references ticket_tiers(id) on delete cascade,
  kind        text not null check (kind in ('sale_open','sale_close')),
  offset_label text not null check (offset_label in ('T-24h','T-1h','T-10m')),
  target_at   timestamptz not null,
  fire_at     timestamptz not null,
  dedupe_key  text not null unique,
  sent_at     timestamptz,
  is_demo     boolean not null default false
);
create index if not exists reminders_due on reminders (fire_at) where sent_at is null;

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid references events(id) on delete cascade,
  alert_id   uuid references alerts(id) on delete set null,
  kind       text not null check (kind in ('going','maybe','not_interested','wrong_artist','wrong_info')),
  note       text,
  channel    text not null default 'web',
  created_at timestamptz not null default now()
);

-- ───────────────────────── ops ─────────────────────────
create table if not exists scan_runs (
  id           uuid primary key default gen_random_uuid(),
  lane         text not null check (lane in ('fast','deep','daily','manual','replay')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running','ok','partial','error','skipped')),
  stats        jsonb not null default '{}',
  error        text
);
create index if not exists scan_runs_started on scan_runs (started_at desc);

-- Lease locks so overlapping cron invocations never run the same lane twice.
create table if not exists locks (
  name        text primary key,
  holder      text not null,
  expires_at  timestamptz not null
);

create table if not exists settings (
  key    text primary key,
  value  jsonb not null
);

create table if not exists gemini_usage (
  id              uuid primary key default gen_random_uuid(),
  at              timestamptz not null default now(),
  task            text not null,
  model           text not null,
  grounded        boolean not null default false,
  status          text not null check (status in ('ok','error','invalid','budget_skip','cache_hit','rate_limited')),
  input_tokens    int,
  output_tokens   int,
  search_queries  int,
  latency_ms      int,
  error           text
);
create index if not exists gemini_usage_at on gemini_usage (at desc);

create table if not exists gemini_cache (
  key         text primary key,           -- sha256(task|model|prompt-version|content-hash)
  task        text not null,
  response    jsonb not null,
  created_at  timestamptz not null default now()
);

-- Singleton row holding AES-256-GCM encrypted Spotify tokens.
create table if not exists spotify_tokens (
  id             int primary key default 1 check (id = 1),
  access_enc     text not null,
  refresh_enc    text not null,
  expires_at     timestamptz not null,
  scope          text,
  updated_at     timestamptz not null default now()
);

-- Atomic lease acquire: returns true if this holder now owns the lock.
create or replace function acquire_lock(p_name text, p_holder text, p_ttl_seconds int)
returns boolean language plpgsql as $$
begin
  insert into locks(name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where locks.expires_at < now() or locks.holder = excluded.holder;
  return exists (select 1 from locks where name = p_name and holder = p_holder);
end $$;
