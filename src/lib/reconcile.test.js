import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseTeamDetail } from './klikego.js'
import { reconcile } from './reconcile.js'

const detail = parseTeamDetail(
  readFileSync(fileURLToPath(new URL('./__fixtures__/klikego-detail.html', import.meta.url)), 'utf8'))

// App disciplines for T24 Ré (matches eventDisciplines windows, in minutes)
const APP_DISC = [
  { key: 'swim',  window: { start: 0,   end: 240 } },
  { key: 'bike',  window: { start: 240, end: 600 } },
  { key: 'bike2', window: { start: 600, end: 960 } },
  { key: 'run',   window: { start: 960, end: 1440 } },
]
const SUFFIX = { 1: 'a1', 2: 'a2', 3: 'a3', 4: 'a4', 5: 'a5', 6: 'a6' }
const RACE_START = Date.parse('2026-06-13T13:00:00Z')

// Synthetic plan: counts chosen to exercise append (swim 9<11) and closure
// (bike 10>8). bike2 / run match klikego exactly.
function makeSlots(key, count, { lockOrder } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${key}-${i + 1}`,
    discipline: key,
    slot_order: i + 1,
    athlete_id: 'planned',
    planned_duration_minutes: 20,
    manual_override: lockOrder === i + 1,
  }))
}
const PLAN = [
  ...makeSlots('swim', 9, { lockOrder: 3 }), // slot 3 is hand-locked
  ...makeSlots('bike', 10),
  ...makeSlots('bike2', 12),
  ...makeSlots('run', 13),
]

const base = over => reconcile({
  laps: detail.laps,
  klikegoDisciplines: detail.disciplines,
  appDisciplines: APP_DISC,
  slots: PLAN,
  athleteBySuffix: SUFFIX,
  raceStartMs: RACE_START,
  ...over,
})

describe('reconcile — discipline mapping guard', () => {
  it('refuses when section counts differ', () => {
    const r = base({ klikegoDisciplines: detail.disciplines.slice(0, 3) })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('discipline-count-mismatch')
  })

  it('maps klikego sections to app keys by order', () => {
    expect(base().nameToKey).toEqual({ Natation: 'swim', 'Vélo': 'bike', 'Vélo 2': 'bike2', Course: 'run' })
  })
})

describe('reconcile — full race (44 laps)', () => {
  const r = base({ raceFinished: true })

  it('overwrites athlete from klikego (suffix → athlete_id)', () => {
    const swim1 = r.upserts.find(u => u.discipline === 'swim' && u.slot_order === 1)
    expect(swim1.athlete_id).toBe('a5') // first swim lap was N°6105-5
    expect(swim1.confirmed).toBe(true)
  })

  it('anchors swim at the gun and bike after swim ends', () => {
    const swim1 = r.upserts.find(u => u.discipline === 'swim' && u.slot_order === 1)
    expect(swim1.actualEndMs).toBe(RACE_START + 1442 * 1000) // 00:24:02

    // bike starts after swim's last cumulative (swim ran past the 4h window)
    const swimLastCum = 4 * 3600 + 7 * 60 + 23 // 04:07:23
    const bikeStart = RACE_START + swimLastCum * 1000
    const bike1 = r.upserts.find(u => u.discipline === 'bike' && u.slot_order === 1)
    expect(bike1.actualStartMs).toBe(bikeStart)
    expect(bike1.actualEndMs).toBe(bikeStart + (1 * 3600 + 2 * 60) * 1000) // bike lap1 cum 01:02:00
  })

  it('skips the hand-locked slot and never writes/deletes it', () => {
    expect(r.skipped).toContain('swim-3')
    expect(r.upserts.some(u => u.id === 'swim-3')).toBe(false)
    expect(r.deletes).not.toContain('swim-3')
  })

  it('appends the 2 swim laps beyond the plan (9 planned, 11 raced)', () => {
    const appended = r.upserts.filter(u => u.discipline === 'swim' && u.id === null)
    expect(appended.map(u => u.slot_order)).toEqual([10, 11])
    expect(appended[0]).toHaveProperty('planned_duration_minutes') // appends carry a duration
  })

  it('drops surplus bike slots via the closure rule (10 planned, 8 raced)', () => {
    expect(r.deletes).toEqual(expect.arrayContaining(['bike-9', 'bike-10']))
    expect(r.deletes.filter(id => id.startsWith('bike-'))).toHaveLength(2)
  })

  it('leaves exactly-matched disciplines clean (bike2 12, run 13)', () => {
    expect(r.upserts.filter(u => u.discipline === 'bike2')).toHaveLength(12)
    expect(r.upserts.filter(u => u.discipline === 'run')).toHaveLength(13)
    expect(r.deletes.some(id => id.startsWith('bike2-') || id.startsWith('run-'))).toBe(false)
  })
})

describe('reconcile — idempotency (no needless writes)', () => {
  it('re-syncing already-synced slots produces zero upserts/deletes', () => {
    const common = {
      laps: detail.laps, klikegoDisciplines: detail.disciplines, appDisciplines: APP_DISC,
      athleteBySuffix: SUFFIX, raceStartMs: RACE_START, raceFinished: true,
    }
    // First sync from an empty plan → 44 appends.
    const first = reconcile({ ...common, slots: [] })
    expect(first.upserts).toHaveLength(44)

    // Materialise those as DB rows (confirmed, ISO timestamps), then sync again.
    const synced = first.upserts.map((u, idx) => ({
      id: `s-${idx}`, discipline: u.discipline, slot_order: u.slot_order,
      athlete_id: u.athlete_id, confirmed: true, manual_override: false,
      actual_start_time: new Date(u.actualStartMs).toISOString(),
      actual_end_time: new Date(u.actualEndMs).toISOString(),
    }))
    const second = reconcile({ ...common, slots: synced })
    expect(second.upserts).toHaveLength(0)
    expect(second.deletes).toHaveLength(0)
  })

  it('writes only the slot that actually changed', () => {
    const common = {
      laps: detail.laps, klikegoDisciplines: detail.disciplines, appDisciplines: APP_DISC,
      athleteBySuffix: SUFFIX, raceStartMs: RACE_START, raceFinished: true,
    }
    const first = reconcile({ ...common, slots: [] })
    const synced = first.upserts.map((u, idx) => ({
      id: `s-${idx}`, discipline: u.discipline, slot_order: u.slot_order,
      athlete_id: u.athlete_id, confirmed: true, manual_override: false,
      actual_start_time: new Date(u.actualStartMs).toISOString(),
      actual_end_time: new Date(u.actualEndMs).toISOString(),
    }))
    // Corrupt one slot's athlete → only that one should be re-written.
    synced[0].athlete_id = 'someone-else'
    const second = reconcile({ ...common, slots: synced })
    expect(second.upserts).toHaveLength(1)
    expect(second.upserts[0].id).toBe('s-0')
  })
})

describe('reconcile — progressive replay (laps appear over time)', () => {
  const replay = n => base({ laps: detail.laps.slice(0, n) })

  it('n=0: nothing to do', () => {
    const r = replay(0)
    expect(r.upserts).toHaveLength(0)
    expect(r.deletes).toHaveLength(0)
  })

  it('n=11 (all swim, no bike yet): swim not closed → appends, no deletes', () => {
    const r = replay(11)
    // 11 laps, slot 3 locked → 10 upserts (8 existing + 2 appended), 1 skipped
    expect(r.upserts.filter(u => u.discipline === 'swim')).toHaveLength(10)
    expect(r.skipped).toContain('swim-3')
    expect(r.deletes).toHaveLength(0) // swim stays "open" while no later discipline has laps
  })

  it('n=12 (first bike lap arrives): future bike2/run plan untouched', () => {
    const r = replay(12)
    expect(r.upserts.some(u => u.discipline === 'bike' && u.slot_order === 1)).toBe(true)
    // bike not closed (no bike2/run laps) → its surplus stays as projection
    expect(r.deletes.some(id => id.startsWith('bike-'))).toBe(false)
    // bike2 + run are pure future → not written or deleted
    expect(r.upserts.some(u => u.discipline === 'bike2' || u.discipline === 'run')).toBe(false)
    expect(r.deletes.some(id => id.startsWith('bike2-') || id.startsWith('run-'))).toBe(false)
  })

  it('lap count rises monotonically with n', () => {
    const counts = [0, 5, 11, 20, 44].map(n => replay(n).upserts.length + replay(n).skipped.length)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
  })
})
