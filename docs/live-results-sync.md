# Live Results Sync (klikego → schedule) — Design

Status: **designed, not built** (decision record from a grilling session, 2026-06-16).
Auto-populate the live race schedule from the official klikego results page so the
team stops hand-confirming every loop. Builds on the existing `schedule_slots`
model, the launch snapshot, and the structural-start clamp.

## Recon facts (klikego)

- **Team detail page** (per team, cumulative — shows all laps from the start):
  `https://www.klikego.com/specific/t24/detail-resultats.jsp?reference=<REF>&dossard=<BIB>&category=<CAT>`
- **Event team list** (resolve team name → dossard): `…/resultats-challenge.jsp?reference=<REF>&category=<CAT>`
- **Server-rendered HTML**, `access-control-allow-origin: *` (browser-fetchable), no JSON API needed.
- **Structure**: team header (name, dossard, total pts) → roster (`6105-N → Full Name`)
  → discipline sections, each `<b>NAME</b> - <small>Distance X km / Y Points</small>`
  then lap lines: `TOUR <n> / N°<bib>-<suffix> / <split> / <cumulative-within-discipline> / <pace>`.
- **Four sections for T24 Ré** map 1:1 to the app: Natation→swim (15pts), Vélo→bike (21pts),
  **Vélo 2→bike2 (16pts)**, Course→run (27pts). The bike2 split is real and confirmed.
- **Cumulative resets per discipline** (it is the running sum of that discipline's splits),
  so there is **no absolute time-of-day per lap** and no explicit start time on the page
  (only the event date range + a page-generation stamp).
- Reference fixture used in tests: team `Rupture du frein`, dossard `6105`, category `EQ-6`,
  876 pts, 44 laps (11 swim / 8 bike / 12 bike2 / 13 run), roster of 6 named athletes.

## Timing anchor

`actual_end_time` = `race_start` → **structural-start clamp per discipline** → `+ per-discipline cumulative`.
Swim is exact (anchored at the gun); bike/bike2/run chain from the prior leg's end, floored to
their window start (reuses the existing clamp). Accepts small **inter-discipline transition-gap
drift** — unavoidable, the page has no absolute per-lap timestamp.

## Decision record

1. **Two modes.** klikego is **Authority when properly configured**; otherwise the room stays in
   today's **manual per-loop confirm**.
2. **Validity = strict binary.** "Properly configured" = three gates green via a **real test-fetch**
   + an **explicit human confirmation** of both team and athlete map. No middle tier.
3. **Discipline mapping** is **1:1 by chronological order**, validated by points-per-loop equality +
   section count. Points in Authority come from **klikego headers** (they match the `events` config).
4. **Switch-in overwrites** already-hand-confirmed loops (clean cutover to truth). A **stall keeps you
   in Authority** (sticky) with degraded health + manual fallback; manual entries during a stall become
   **locked overrides** klikego respects on recovery. Mode reverts to manual **only if config is cleared**.
5. **Reconciler** keys laps→slots by **discipline + order**, overwrites athlete from klikego. More laps →
   **append**; fewer → **closure rule** (drop surplus planned slots only once a later discipline has ≥1 lap,
   or race ends). Untouched future slots stay as projection. Plan stays frozen in the launch snapshot, so
   divergence never hurts the points chart.
6. **Poller = Supabase Edge Function + pg_cron** (production engine), with a client **"Sync now"** button
   retained as the manual fallback + dev/test harness. Parser + reconciler are **pure functions shared by
   both**. Build order: pure core → client Sync now → deploy function → manual invoke → add cron last.
7. **Config + Authority state live on the room row**; any member can set/confirm (no auth, consistent with
   the rest of the app). A **mid-race config edit invalidates confirmation → drops to manual** until
   re-confirmed (with a warning).
8. **Athlete mapping**: store **`bib_suffix`** on `athletes`. UX = roster rows with app-athlete dropdowns,
   auto-suggest by name (manual is the norm — app names are often placeholders). **Every klikego racer
   mapped 1:1 to a distinct app athlete, or no Authority.**
9. **Override (escape hatch)** = **whole slot** (time + athlete), **permanent until "↻ revert to live"**,
   a **quiet auto-clearing** per-slot discrepancy hint (`live: HH:mm · use live`), **no room-level alarm**.
   Accepts the order-keyed-lock edge case (a retroactive klikego insert could shift a lock; unlikely).
10. **Health = fetch-success model.** `results_synced_at` = last *successful fetch+parse* (updated even
    with no new laps). Freshness chip off it. **Stall = >5 min stale** → degraded banner + manual fallback
    unlocks. **"No new laps" is never flagged** (laps are 20–40 min apart). "Now racing" + the points chart
    need **no new logic** — klikego just confirms slots instead of a thumb.

## Schema changes (all additive)

- `rooms`: `results_reference text`, `results_dossard text`, `results_category text`,
  `results_confirmed boolean default false`, `results_synced_at timestamptz`
- `athletes`: `bib_suffix int`
- `schedule_slots`: `manual_override boolean default false`

Authority engaged ⟺ config present **and** `results_confirmed` **and** all racers mapped. That
confirmed-valid state *is* the on-switch (no separate toggle; clearing/editing opts out).

## Implementation phases

1. **Parser** — pure, tested against the saved fixture.
2. **Reconciler** — pure: order-keying, athlete overwrite via `bib_suffix`, append/closure,
   `manual_override` guard. Tested via **progressive replay** of the fixture (laps with `cum ≤ T`, rising T).
3. **Source config + mapping UI** — paste link → pick team → map athletes → confirm.
4. **Client "Sync now"** — first real end-to-end; doubles as the stall fallback.
5. **Edge Function** — same pure core, deployed via Supabase tooling; manual-invoke to verify.
6. **pg_cron trigger** — last, ~60s cadence, behind the already-proven pipeline.
7. **Live-race UX swap** — hide confirm in Authority, freshness chip, stall banner, per-slot
   override/revert, discrepancy hint.

Remaining are pure implementation details (lap idempotency key = room+discipline+lap#, Deno port,
cron auth wiring) — no open design decisions.
