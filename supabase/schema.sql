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
  ('t24-breizh-2026', 'T24 Breizh 2026', 1, 15.7, 5.2, 15, 16, 24, null, null, null, '2026-06-27T13:00'),
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
  created_at       timestamptz not null default now()
);

-- Migrations for an existing rooms table:
alter table rooms add column if not exists name text;
alter table rooms add column if not exists event_id text;

create table if not exists athletes (
  id         uuid  primary key default gen_random_uuid(),
  room_code  text  not null references rooms(code) on delete cascade,
  name       text  not null,
  color      text  not null,
  position   int   not null,
  swim_pace  int   not null default 20,  -- minutes per loop
  bike_pace  int   not null default 40,
  run_pace   int   not null default 30,
  bike2_pace int                          -- optional override for the 2nd cycling segment (null = auto-derived)
);

-- Migration for an existing athletes table:
alter table athletes add column if not exists bike2_pace int;

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
  created_at               timestamptz not null default now()
);

-- Enable realtime for all three tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table athletes;
alter publication supabase_realtime add table schedule_slots;
