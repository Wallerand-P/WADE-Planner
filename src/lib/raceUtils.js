import dayjs from 'dayjs'

export const DISCIPLINE_ORDER = ['swim', 'bike', 'run']

export const DISCIPLINE_DURATIONS = { swim: 240, bike: 720, run: 480 } // total minutes

export const DISCIPLINE_META = {
  swim: { label: 'Swimming', short: 'Swim', bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500',   badge: 'bg-blue-500'   },
  bike: { label: 'Cycling',  short: 'Bike', bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500',  badge: 'bg-amber-500'  },
  run:  { label: 'Running',  short: 'Run',  bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500', badge: 'bg-emerald-500' },
}

export const ATHLETE_COLORS = ['#f43f5e', '#a855f7', '#38bdf8', '#fb923c']

// Points scored per kilometre, per discipline
export const POINTS_PER_KM = { swim: 15, bike: 1, run: 4 }

// Selectable races. lengthsKm = loop distance per discipline (one loop).
export const EVENTS = {
  't24-breizh-2026': {
    id: 't24-breizh-2026',
    name: 'T24 Breizh 2026',
    lengthsKm: { swim: 1, bike: 15.7, run: 5.2 },
  },
}

// Points earned for completing one loop of each discipline for a given event
export function pointsPerLoop(lengthsKm) {
  return DISCIPLINE_ORDER.reduce((acc, d) => {
    acc[d] = lengthsKm[d] * POINTS_PER_KM[d]
    return acc
  }, {})
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
