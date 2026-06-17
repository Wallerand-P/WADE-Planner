# sync-results Edge Function

Polls klikego for every `racing`, `results_confirmed` room and reconciles its
schedule (Authority mode). Server-side counterpart of the client "Sync now"
button — runs even when no phone is open. See `docs/live-results-sync.md`.

## Bundled modules

`klikego.js`, `reconcile.js`, and `disciplines.js` are **verbatim copies** of
`src/lib/` (all pure, dependency-free, Deno-compatible), so server and client run
identical parse + reconcile logic. If you change those in `src/lib/`, re-copy them
here and redeploy:

```
cp src/lib/{klikego,reconcile,disciplines}.js supabase/functions/sync-results/
```

## Deploy

Deployed with `verify_jwt: true`. Edge Functions automatically receive
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — no secrets to configure.

## Schedule (pg_cron)

A `pg_cron` job hits the function URL every minute via `pg_net`. The job already
exists in the database; recreate it like this (substitute the project's anon key —
it's a public JWT, already shipped in the client, just not committed here):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-klikego-results',
  '* * * * *',  -- every minute; the function no-ops when no room is racing+confirmed
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-results',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    )
  );
  $$
);
```

The function itself is cheap and idempotent: re-running maps laps to the existing
slots by order (no duplicate inserts), so a 1-minute cadence is safe.
