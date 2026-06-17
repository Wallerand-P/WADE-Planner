import dayjs from 'dayjs'

// Canonical ordering of every discipline key, used only to sort slots.
export const DISCIPLINE_SORT = ['swim', 'bike', 'bike2', 'run']

// Styling + pace behaviour per discipline GROUP. A discipline (e.g. the two
// cycling segments) maps to one of these groups for colour and pace formatting.
export const GROUP_META = {
  swim: { label: 'Swimming', short: 'Swim', bg: 'bg-blue-500/20',    text: 'text-blue-400',    border: 'border-blue-500',    badge: 'bg-blue-500'    },
  bike: { label: 'Cycling',  short: 'Bike', bg: 'bg-amber-500/20',   text: 'text-amber-400',   border: 'border-amber-500',   badge: 'bg-amber-500'   },
  run:  { label: 'Running',  short: 'Run',  bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500', badge: 'bg-emerald-500' },
}

export const ATHLETE_COLORS = ['#f43f5e', '#a855f7', '#38bdf8', '#fb923c', '#34d399', '#facc15']

// Selectable team sizes
export const TEAM_SIZES = [1, 2, 4, 6]

// Event → disciplines lives in a dayjs-free module so the klikego Edge Function
// can share it verbatim. Re-exported here for existing import sites.
export { POINTS_PER_KM, eventDisciplines, eventLengthsKm, eventLoopPoints } from './disciplines.js'

// Effective minutes-per-loop for an athlete on a discipline. Applies the
// auto-derive for a derived segment (e.g. Bike II = Bike I pace scaled by the
// distance ratio) when the athlete has no explicit override for it.
export function athleteLoopMinutes(athlete, disc, disciplines) {
  const raw = athlete[disc.paceField]
  if (raw != null && raw !== '') return Number(raw)
  if (disc.deriveFrom) {
    const base = disciplines.find(d => d.key === disc.deriveFrom)
    const basePace = base && athlete[base.paceField]
    if (base && base.km && disc.km && basePace) {
      return Math.round(Number(basePace) * disc.km / base.km)
    }
  }
  return Number(raw) || 0
}

// Round points for display (one decimal, drop trailing .0)
export function fmtPoints(n) {
  return Math.round(n * 10) / 10
}

// Points implied by a set of slots (each slot = one loop of its discipline),
// given the per-loop points map. Returns total + breakdown by discipline and
// athlete.
export function computePoints(slots, perLoop) {
  const byDiscipline = {}
  const byAthlete = {}
  let total = 0
  for (const s of slots) {
    const pts = perLoop[s.discipline] || 0
    byDiscipline[s.discipline] = (byDiscipline[s.discipline] || 0) + pts
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
    const d = DISCIPLINE_SORT.indexOf(a.discipline) - DISCIPLINE_SORT.indexOf(b.discipline)
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
// effective start (minutes from race start). Early finishes don't add time: a
// discipline can't start before its window opens. `disciplines` is the ordered
// list from eventDisciplines().
export function computeDisciplineBudgets(slots, disciplines) {
  const budgets = {}
  const starts = {}
  let prevEnd = 0
  for (const d of disciplines) {
    const start = Math.max(d.window.start, prevEnd)
    starts[d.key] = start
    budgets[d.key] = d.window.end - start
    prevEnd = start + getScheduledMinutes(slots, d.key)
  }
  return { budgets, starts }
}

// Returns a map of slotId → planned start time (ms), accounting for confirmed
// actuals. When `disciplines` is passed, a discipline can't begin before its
// structural start time even if the team is ahead — e.g. cycling never starts
// before race-hour 4. Falling behind still slides everything later as usual.
export function computeStartTimes(slots, raceStartTime, disciplines = null) {
  const sorted = getSortedSlots(slots)
  const raceStartMs = dayjs(raceStartTime).valueOf()
  const windowStart = disciplines
    ? Object.fromEntries(disciplines.map(d => [d.key, d.window.start]))
    : null
  const result = {}
  let cursor = raceStartMs
  for (const slot of sorted) {
    // Floor to the discipline's structural start. It's a max, so it only bites
    // when ahead; when behind, the cursor is already past it (no-op).
    const ws = windowStart && windowStart[slot.discipline]
    if (ws != null) cursor = Math.max(cursor, raceStartMs + ws * 60_000)
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

// Speed/pace label for a discipline group, from a loop time (minutes) and loop
// distance (km). swim → min/100m, bike → km/h, run → min/km. Returns null if
// inputs are missing.
export function paceLabel(group, minutes, km) {
  const min = Number(minutes)
  if (!min || !km) return null
  if (group === 'swim') return `${fmtMinSec(min / (km * 10))}/100m`
  if (group === 'run')  return `${fmtMinSec(min / km)}/km`
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
