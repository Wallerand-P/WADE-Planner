import dayjs from 'dayjs'

export const DISCIPLINE_ORDER = ['swim', 'bike', 'run']

export const DISCIPLINE_DURATIONS = { swim: 240, bike: 720, run: 480 } // nominal minutes

// Fixed start windows (minutes from race start). A discipline's loops may only
// START within [start, end]; a loop may FINISH after `end`, and that overrun
// pushes back the next discipline's start, shrinking its available time. The
// next discipline can never start before its window opens (an early finish
// doesn't add time).
export const DISCIPLINE_WINDOWS = {
  swim: { start: 0,   end: 240 },
  bike: { start: 240, end: 960 },
  run:  { start: 960, end: 1440 },
}

export const DISCIPLINE_META = {
  swim: { label: 'Swimming', short: 'Swim', bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500',   badge: 'bg-blue-500'   },
  bike: { label: 'Cycling',  short: 'Bike', bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500',  badge: 'bg-amber-500'  },
  run:  { label: 'Running',  short: 'Run',  bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500', badge: 'bg-emerald-500' },
}

export const ATHLETE_COLORS = ['#f43f5e', '#a855f7', '#38bdf8', '#fb923c']

// Points scored per kilometre, per discipline
export const POINTS_PER_KM = { swim: 15, bike: 1, run: 4 }

// Map an `events` table row to per-discipline loop distances (km)
export function eventLengthsKm(event) {
  return { swim: Number(event.swim_km), bike: Number(event.bike_km), run: Number(event.run_km) }
}

// Default points for one loop of each discipline, from distance × points/km
export function pointsPerLoop(lengthsKm) {
  return DISCIPLINE_ORDER.reduce((acc, d) => {
    acc[d] = lengthsKm[d] * POINTS_PER_KM[d]
    return acc
  }, {})
}

// Points for one loop of each discipline for an event. Uses the event's
// explicit per-loop points when set, otherwise the distance-based default.
export function eventLoopPoints(event) {
  const fallback = pointsPerLoop(eventLengthsKm(event))
  const explicit = { swim: event.swim_points, bike: event.bike_points, run: event.run_points }
  return DISCIPLINE_ORDER.reduce((acc, d) => {
    acc[d] = explicit[d] != null ? Number(explicit[d]) : fallback[d]
    return acc
  }, {})
}

// Round points for display (one decimal, drop trailing .0)
export function fmtPoints(n) {
  return Math.round(n * 10) / 10
}

// Points implied by a set of slots (each slot = one loop of its discipline),
// given the per-loop points map. Returns total + breakdown by discipline and
// athlete.
export function computePoints(slots, perLoop) {
  const byDiscipline = { swim: 0, bike: 0, run: 0 }
  const byAthlete = {}
  let total = 0
  for (const s of slots) {
    const pts = perLoop[s.discipline] || 0
    byDiscipline[s.discipline] += pts
    byAthlete[s.athlete_id] = (byAthlete[s.athlete_id] || 0) + pts
    total += pts
  }
  return { total, byDiscipline, byAthlete, perLoop }
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function getSortedSlots(slots) {
  return [...slots].sort((a, b) => {
    const d = DISCIPLINE_ORDER.indexOf(a.discipline) - DISCIPLINE_ORDER.indexOf(b.discipline)
    return d !== 0 ? d : a.slot_order - b.slot_order
  })
}

export function getScheduledMinutes(slots, discipline) {
  return slots
    .filter(s => s.discipline === discipline)
    .reduce((sum, s) => sum + Number(s.planned_duration_minutes), 0)
}

// Available minutes per discipline given the scheduled loop totals, cascading
// any boundary overrun into the next discipline. Also returns each discipline's
// effective start (minutes from race start) and its nominal budget for
// reference. Early finishes don't add time: a discipline can't start before its
// window opens.
export function computeDisciplineBudgets(slots) {
  const budgets = {}
  const starts = {}
  let prevEnd = 0
  for (const d of DISCIPLINE_ORDER) {
    const w = DISCIPLINE_WINDOWS[d]
    const start = Math.max(w.start, prevEnd)
    starts[d] = start
    budgets[d] = w.end - start
    prevEnd = start + getScheduledMinutes(slots, d)
  }
  return { budgets, starts }
}

// Returns a map of slotId → planned start time (ms), accounting for confirmed actuals
export function computeStartTimes(slots, raceStartTime) {
  const sorted = getSortedSlots(slots)
  const result = {}
  let cursor = dayjs(raceStartTime).valueOf()
  for (const slot of sorted) {
    result[slot.id] = cursor
    if (slot.confirmed && slot.actual_end_time) {
      cursor = dayjs(slot.actual_end_time).valueOf()
    } else {
      cursor += Number(slot.planned_duration_minutes) * 60_000
    }
  }
  return result
}

// First unconfirmed slot in order
export function getCurrentSlot(slots) {
  return getSortedSlots(slots).find(s => !s.confirmed) ?? null
}

export function formatDuration(minutes) {
  const m = Math.round(Math.abs(minutes))
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}min`
  if (rem === 0) return `${h}h`
  return `${h}h${rem.toString().padStart(2, '0')}`
}

// Format a duration in (fractional) minutes as m:ss
function fmtMinSec(minutes) {
  const totalSec = Math.round(minutes * 60)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Speed/pace label for one discipline, from a loop time (minutes) and loop
// distance (km). Swim → min/100m, bike → km/h, run → min/km. Returns null if
// inputs are missing.
export function paceLabel(discipline, minutes, km) {
  const min = Number(minutes)
  if (!min || !km) return null
  if (discipline === 'swim') return `${fmtMinSec(min / (km * 10))}/100m`
  if (discipline === 'run')  return `${fmtMinSec(min / km)}/km`
  const kmh = km / (min / 60)
  return `${Math.round(kmh * 10) / 10} km/h`
}

export function formatCountdown(ms) {
  const neg = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const str = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return neg ? `-${str}` : str
}
