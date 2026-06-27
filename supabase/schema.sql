-- Run this in your Supabase SQL editor.
-- Note: RLS is not enabled — the room code is the only access control.

create extension if not exists "pgcrypto";

-- Races. Distances are the loop length (one loop) per discipline, in km.
-- *_points override the points awarded for one loop; when null the app falls
-- back to distance(km) × points-per-km (swim 15, bike 1, run 4).
-- bike2_* describe an optional SECOND cycling segment (some events split the
-- 12h bike block into two zones with different loops). bike_split_min is the
-- race-minute where cycling switches from segment 1 to segment 2 (e.g. 600 =
-- race-hour 10). When bike2_km is null the event has a single cycling segment.
-- default_start is the suggested race start, a naive local datetime string
-- (YYYY-MM-DDTHH:mm) that pre-fills the Setup start-time field when chosen.
create table if not exists events (
  id             text    primary key,
  name           text    not null,
  swim_km        numeric not null,
  bike_km        numeric not null,
  run_km         numeric not null,
  swim_points    numeric,
  bike_points    numeric,
  run_points     numeric,
  bike2_km       numeric,
  bike2_points   numeric,
  bike_split_min integer,
  default_start  text
);

-- Migrations for an existing events table:
alter table events add column if not exists swim_points numeric;
alter table events add column if not exists bike_points numeric;
alter table events add column if not exists run_points  numeric;
alter table events add column if not exists bike2_km numeric;
alter table events add column if not exists bike2_points numeric;
alter table events add column if not exists bike_split_min integer;
alter table events add column if not exists default_start text;

insert into events (id, name, swim_km, bike_km, run_km, swim_points, bike_points, run_points, bike2_km, bike2_points, bike_split_min, default_start)
values
  -- T24 Breizh's klikego page emits 4 sections (Natation/Vélo/Vélo 2/Course);
  -- the short Vélo 2 (1km/1pt) must be modelled or live-results sync fails the
  -- 1:1 discipline-count check. bike_split_min=950 makes Vélo 2 a tiny tail.
  ('t24-breizh-2026', 'T24 Breizh 2026', 1, 15.7, 6, 15, 16, 24, 1, 1, 950, '2026-06-27T13:00'),
  ('t24-re-2026',     'T24 Ré 2026',     1, 20.9, 7,   15, 21, 27, 15.9, 16,   600,  '2026-06-13T13:00')
on conflict (id) do update set
  name = excluded.name,
  swim_km = excluded.swim_km, bike_km = excluded.bike_km, run_km = excluded.run_km,
  swim_points = excluded.swim_points, bike_points = excluded.bike_points, run_points = excluded.run_points,
  bike2_km = excluded.bike2_km, bike2_points = excluded.bike2_points, bike_split_min = excluded.bike_split_min,
  default_start = excluded.default_start;

create table if not exists rooms (
  code             text        primary key,
  name             text,
  event_id         text,
  status           text        not null default 'setup',  -- setup | planning | racing | finished
  race_start_time  timestamptz,
  -- Frozen copy of the schedule taken when the race is launched, so the live
  -- race can be compared to the original plan even after slots are edited.
  -- Shape: { start, points: {disc: ptsPerLoop}, slots: [{discipline, minutes}] }.
  -- Re-launching the race overwrites it (re-baselines).
  plan_snapshot    jsonb,
  -- Live-results sync (klikego). When results_confirmed is true the room is in
  -- "Authority" mode: the schedule mirrors the official klikego results instead
  -- of manual per-loop confirmation. reference/dossard/category identify the
  -- team's page; results_synced_at = last successful fetch+parse (NOT last new
  -- lap — laps are sparse). See docs/live-results-sync.md.
  results_reference text,
  results_dossard   text,
  results_category  text,
  results_confirmed boolean not null default false,
  results_synced_at timestamptz,
  created_at       timestamptz not null default now()
);

-- Migrations for an existing rooms table:
alter table rooms add column if not exists name text;
alter table rooms add column if not exists event_id text;
alter table rooms add column if not exists plan_snapshot jsonb;
alter table rooms add column if not exists results_reference text;
alter table rooms add column if not exists results_dossard   text;
alter table rooms add column if not exists results_category  text;
alter table rooms add column if not exists results_confirmed boolean not null default false;
alter table rooms add column if not exists results_synced_at timestamptz;

create table if not exists athletes (
  id         uuid  primary key default gen_random_uuid(),
  room_code  text  not null references rooms(code) on delete cascade,
  name       text  not null,
  color      text  not null,
  position   int   not null,
  swim_pace  int   not null default 20,  -- minutes per loop
  bike_pace  int   not null default 40,
  run_pace   int   not null default 30,
  bike2_pace int,                         -- optional override for the 2nd cycling segment (null = auto-derived)
  bib_suffix int                          -- klikego athlete number within the team (e.g. 5 in N°6105-5); links live results to this athlete
);

-- Migration for an existing athletes table:
alter table athletes add column if not exists bike2_pace int;
alter table athletes add column if not exists bib_suffix int;

create table if not exists schedule_slots (
  id                       uuid    primary key default gen_random_uuid(),
  room_code                text    not null references rooms(code) on delete cascade,
  discipline               text    not null check (discipline in ('swim', 'bike', 'bike2', 'run')),
  slot_order               int     not null,
  athlete_id               uuid    not null references athletes(id),
  planned_duration_minutes numeric not null,
  actual_start_time        timestamptz,
  actual_end_time          timestamptz,
  confirmed                boolean not null default false,
  -- A human has hand-edited this slot; live-results sync must never overwrite or
  -- delete it (the lock wins). Cleared by "revert to live". See docs/live-results-sync.md.
  manual_override          boolean not null default false,
  created_at               timestamptz not null default now()
);

-- Migration for an existing schedule_slots table:
alter table schedule_slots add column if not exists manual_override boolean not null default false;

-- Enable realtime for all three tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table athletes;
alter publication supabase_realtime add table schedule_slots;

-- Scheduled jobs (pg_cron). T24 is a 24h race; auto-finish any room still
-- 'racing' 26h after its start (2h buffer) so stale races don't poll/linger
-- forever. Pure SQL, runs in-DB; flipping status to 'finished' propagates to
-- every phone via the realtime subscription above. (The klikego live-results
-- poller is a second cron — see supabase/functions/sync-results/README.md.)
create extension if not exists pg_cron;
select cron.schedule(
  'auto-end-races',
  '* * * * *',
  $$ update rooms set status = 'finished'
     where status = 'racing' and race_start_time < now() - interval '26 hours' $$
);
