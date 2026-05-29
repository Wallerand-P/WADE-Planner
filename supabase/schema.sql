-- Run this in your Supabase SQL editor.
-- Note: RLS is not enabled — the room code is the only access control.

create extension if not exists "pgcrypto";

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
  run_pace   int   not null default 30
);

create table if not exists schedule_slots (
  id                       uuid    primary key default gen_random_uuid(),
  room_code                text    not null references rooms(code) on delete cascade,
  discipline               text    not null check (discipline in ('swim', 'bike', 'run')),
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
