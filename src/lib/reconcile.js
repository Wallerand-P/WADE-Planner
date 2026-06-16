// Pure reconciler: parsed klikego laps + the current plan → a set of slot writes
// that make the schedule mirror the official results. No I/O — the caller (client
// "Sync now" or the Edge Function) applies the result to Supabase.
//
// Rules (see docs/live-results-sync.md):
//  - klikego sections map 1:1 to app disciplines by chronological order.
//  - Laps key to slots by discipline + order; athlete is overwritten from klikego.
//  - Times are anchored: each discipline starts at max(structural window, prev
//    discipline's actual end), then + the per-discipline cumulative.
//  - More laps than planned → append; fewer → drop surplus only once the
//    discipline is "closed" (a later discipline has laps, or the race finished).
//  - manual_override slots are never written or deleted (the lock wins).

/**
 * @param laps             parsed laps: [{ discipline (klikego name), tour, suffix, splitSec, cumSec }]
 * @param klikegoDisciplines parsed sections in order: [{ name }]
 * @param appDisciplines   app disciplines in order: [{ key, window:{start,end} }] (minutes)
 * @param slots            existing schedule_slots: [{ id, discipline, slot_order, athlete_id, manual_override }]
 * @param athleteBySuffix  { [suffix]: athlete_id }
 * @param raceStartMs      race start, ms
 * @param raceFinished     whether the race is over (closes every discipline)
 * @returns { ok, reason?, nameToKey, upserts, deletes, skipped }
 *   upserts: { id|null, discipline, slot_order, athlete_id, actualStartMs, actualEndMs,
 *              confirmed:true, planned_duration_minutes? }   (planned_* only on appends)
 *   deletes: slotId[]   surplus planned slots dropped by the closure rule
 *   skipped: slotId[]   manual_override slots left untouched
 */
export function reconcile({
  laps, klikegoDisciplines, appDisciplines, slots,
  athleteBySuffix, raceStartMs, raceFinished = false,
}) {
  if (klikegoDisciplines.length !== appDisciplines.length) {
    return { ok: false, reason: 'discipline-count-mismatch', nameToKey: {}, upserts: [], deletes: [], skipped: [] }
  }

  // klikego section name → app discipline key, by order
  const nameToKey = {}
  klikegoDisciplines.forEach((d, i) => { nameToKey[d.name] = appDisciplines[i].key })
  const winStartMs = {}
  appDisciplines.forEach(d => { winStartMs[d.key] = raceStartMs + d.window.start * 60_000 })

  // Group klikego laps by app key, in tour order
  const byKey = {}
  for (const lap of laps) {
    const key = nameToKey[lap.discipline]
    if (!key) continue
    ;(byKey[key] ||= []).push(lap)
  }
  for (const k of Object.keys(byKey)) byKey[k].sort((a, b) => a.tour - b.tour)

  // Anchor each discipline's start (chain + structural clamp) → absolute lap times
  const lapTimes = {}
  let prevEndMs = raceStartMs
  for (const d of appDisciplines) {
    const ls = byKey[d.key]
    if (!ls || ls.length === 0) continue // no laps yet → don't advance the cursor
    const startMs = Math.max(winStartMs[d.key], prevEndMs)
    lapTimes[d.key] = ls.map((lap, i) => ({
      startMs: startMs + (i > 0 ? ls[i - 1].cumSec * 1000 : 0),
      endMs: startMs + lap.cumSec * 1000,
    }))
    prevEndMs = startMs + ls[ls.length - 1].cumSec * 1000
  }

  // Existing slots grouped + ordered per discipline
  const slotsByKey = {}
  for (const s of slots) (slotsByKey[s.discipline] ||= []).push(s)
  for (const k of Object.keys(slotsByKey)) slotsByKey[k].sort((a, b) => a.slot_order - b.slot_order)

  // A discipline is "closed" once a later one has laps (or the race is over)
  const keyOrder = appDisciplines.map(d => d.key)
  const hasLaps = key => (byKey[key]?.length || 0) > 0
  const closed = {}
  appDisciplines.forEach((d, i) => {
    closed[d.key] = raceFinished || keyOrder.slice(i + 1).some(hasLaps)
  })

  const upserts = [], deletes = [], skipped = []
  for (const d of appDisciplines) {
    const ls = byKey[d.key] || []
    const times = lapTimes[d.key] || []
    const existing = slotsByKey[d.key] || []

    ls.forEach((lap, i) => {
      const slot = existing[i]
      if (slot && slot.manual_override) { skipped.push(slot.id); return }
      const athlete_id = athleteBySuffix[lap.suffix] ?? slot?.athlete_id ?? null
      upserts.push({
        id: slot?.id ?? null,
        discipline: d.key,
        slot_order: i + 1,
        athlete_id,
        actualStartMs: times[i].startMs,
        actualEndMs: times[i].endMs,
        confirmed: true,
        ...(slot ? {} : { planned_duration_minutes: Math.max(1, Math.round(lap.splitSec / 60)) }),
      })
    })

    // Surplus planned slots: drop them only once the discipline is closed; keep
    // any that a human has locked. Before closure they're future projection.
    if (closed[d.key]) {
      for (const s of existing.slice(ls.length)) {
        if (s.manual_override) skipped.push(s.id)
        else deletes.push(s.id)
      }
    }
  }

  return { ok: true, nameToKey, upserts, deletes, skipped }
}
