// Event → ordered discipline list. Pure and dependency-free (no dayjs), so it
// can be shared verbatim by the app and the klikego Edge Function. raceUtils
// re-exports these for existing import sites.

// Points scored per kilometre, per group (fallback when an event doesn't
// specify explicit per-loop points).
export const POINTS_PER_KM = { swim: 15, bike: 1, run: 4 }

// The ordered list of disciplines for an event — or the default swim/bike/run
// when there's no event (or no second cycling segment). Each entry carries its
// time window (minutes from race start), loop distance/points, styling group,
// and the athlete pace field it reads. Events with `bike2_km` set split cycling
// into two segments (Cycling I / Cycling II) at `bike_split_min`.
export function eventDisciplines(event) {
  const num = v => (v == null || v === '' ? null : Number(v))
  const hasBike2 = !!(event && num(event.bike2_km) != null)
  const split = hasBike2 ? (num(event.bike_split_min) ?? 600) : 960

  const pts = (explicit, km, group) => {
    if (!event) return null
    const e = num(explicit)
    if (e != null) return e
    return km != null ? km * POINTS_PER_KM[group] : null
  }
  const swimKm = event ? num(event.swim_km) : null
  const bikeKm = event ? num(event.bike_km) : null
  const bike2Km = event ? num(event.bike2_km) : null
  const runKm = event ? num(event.run_km) : null

  const list = [
    { key: 'swim', group: 'swim', paceField: 'swim_pace', label: 'Swimming',
      short: 'Swim', km: swimKm, points: pts(event && event.swim_points, swimKm, 'swim'),
      window: { start: 0, end: 240 } },
    { key: 'bike', group: 'bike', paceField: 'bike_pace',
      label: hasBike2 ? 'Cycling I' : 'Cycling', short: hasBike2 ? 'Bike I' : 'Bike',
      km: bikeKm, points: pts(event && event.bike_points, bikeKm, 'bike'),
      window: { start: 240, end: split } },
  ]
  if (hasBike2) {
    list.push({ key: 'bike2', group: 'bike', paceField: 'bike2_pace', label: 'Cycling II',
      short: 'Bike II', km: bike2Km, points: pts(event.bike2_points, bike2Km, 'bike'),
      window: { start: split, end: 960 }, deriveFrom: 'bike' })
  }
  list.push({ key: 'run', group: 'run', paceField: 'run_pace', label: 'Running',
    short: 'Run', km: runKm, points: pts(event && event.run_points, runKm, 'run'),
    window: { start: 960, end: 1440 } })
  return list
}

// Convenience maps keyed by discipline key
export function eventLengthsKm(event) {
  return Object.fromEntries(eventDisciplines(event).map(d => [d.key, d.km]))
}
export function eventLoopPoints(event) {
  return Object.fromEntries(eventDisciplines(event).map(d => [d.key, d.points]))
}
