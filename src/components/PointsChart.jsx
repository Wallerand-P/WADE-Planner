import { useState } from 'react'
import dayjs from 'dayjs'
import { getSortedSlots, fmtPoints } from '../lib/raceUtils'

// Plan vs reality: cumulative points over the race, planned (frozen snapshot
// taken at launch) against actual (confirmed loops) plus a dashed projection
// of the remaining schedule. Renders as a compact strip; tap to expand.
//
// snapshot shape: { start, points: {disc: ptsPerLoop}, slots: [{discipline, minutes}] }

// Build an SVG step-after path from [{t, p}] curve points
function stepPath(pts, x, y) {
  if (pts.length === 0) return ''
  let d = `M ${x(pts[0].t)} ${y(pts[0].p)}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${x(pts[i].t)} ${y(pts[i - 1].p)} L ${x(pts[i].t)} ${y(pts[i].p)}`
  }
  return d
}

export default function PointsChart({ snapshot, slots, raceStartTime, now }) {
  const [expanded, setExpanded] = useState(false)

  const perLoop = snapshot?.points
  if (!perLoop || !Array.isArray(snapshot.slots) || snapshot.slots.length === 0) return null

  const pts = d => Number(perLoop[d]) || 0

  // Planned curve — from the frozen snapshot
  const snapStartMs = dayjs(snapshot.start).valueOf()
  const planned = [{ t: snapStartMs, p: 0 }]
  {
    let t = snapStartMs, p = 0
    for (const s of snapshot.slots) {
      t += Number(s.minutes) * 60_000
      p += pts(s.discipline)
      planned.push({ t, p })
    }
  }
  const plannedTotal = planned[planned.length - 1].p
  if (plannedTotal <= 0) return null

  // Actual curve — confirmed loops at their real end times
  const raceStartMs = dayjs(raceStartTime).valueOf()
  const sorted = getSortedSlots(slots)
  const actual = [{ t: raceStartMs, p: 0 }]
  let cursor = raceStartMs
  let actualPts = 0
  for (const s of sorted) {
    if (!s.confirmed || !s.actual_end_time) break
    cursor = dayjs(s.actual_end_time).valueOf()
    actualPts += pts(s.discipline)
    actual.push({ t: cursor, p: actualPts })
  }
  // Projection — remaining unconfirmed slots at their planned durations
  const projection = [{ t: cursor, p: actualPts }]
  {
    let t = cursor, p = actualPts
    for (const s of sorted) {
      if (s.confirmed) continue
      t += Number(s.planned_duration_minutes) * 60_000
      p += pts(s.discipline)
      projection.push({ t, p })
    }
  }
  const projectedTotal = projection[projection.length - 1].p

  // Planned points at "now" (step function), for the ahead/behind delta
  let plannedNow = 0
  for (const pt of planned) {
    if (pt.t <= now) plannedNow = pt.p
    else break
  }
  const delta = actualPts - plannedNow
  const ahead = delta >= 0

  // Scales
  const W = 320
  const H = expanded ? 150 : 56
  const tMin = Math.min(snapStartMs, raceStartMs)
  // Axis spans the schedules only — `now` is clamped into it, so a forgotten
  // race that runs long doesn't squash the chart.
  const tMax = Math.max(
    planned[planned.length - 1].t,
    projection[projection.length - 1].t
  )
  const pMax = Math.max(plannedTotal, projectedTotal, 1)
  const x = t => ((t - tMin) / (tMax - tMin)) * W
  const y = p => H - (p / pMax) * (H - 4)

  const nowX = Math.min(Math.max(x(now), 0), W)
  const stroke = { fill: 'none', vectorEffect: 'non-scaling-stroke' }

  return (
    <button
      onClick={() => setExpanded(v => !v)}
      className="card w-full text-left p-4 active:scale-[0.99] transition-all"
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="label-eyebrow">Points vs plan</span>
        <span className={`text-sm font-bold font-mono tabular-nums ${
          ahead ? 'text-emerald-400' : 'text-rose-400'
        }`}>
          {ahead ? '▲' : '▼'} {fmtPoints(Math.abs(delta))} pts
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        style={{ height: H }}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* planned */}
        <path d={stepPath(planned, x, y)} {...stroke} stroke="rgba(255,255,255,0.30)" strokeWidth="1.5" />
        {/* projection */}
        <path d={stepPath(projection, x, y)} {...stroke} stroke="rgba(56,189,248,0.65)" strokeWidth="1.5" />
        {/* actual */}
        <path d={stepPath(actual, x, y)} {...stroke} stroke="#818cf8" strokeWidth="2.5" />
        {/* now marker */}
        <line x1={nowX} y1="0" x2={nowX} y2={H} stroke="rgba(255,255,255,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
      </svg>

      {expanded && (
        <div className="mt-2.5 space-y-2">
          <div className="flex justify-between text-[10px] text-white/35 font-mono tabular-nums">
            <span>{dayjs(tMin).format('HH:mm')}</span>
            <span>{dayjs((tMin + tMax) / 2).format('HH:mm')}</span>
            <span>{dayjs(tMax).format('HH:mm')}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-white/55">
              <span className="inline-block w-4 h-0 border-t-2 border-indigo-400" />
              Actual · {fmtPoints(actualPts)} pts
            </span>
            <span className="flex items-center gap-1.5 text-white/55">
              <span className="inline-block w-4 h-0 border-t-2 border-sky-400/65" />
              Projected · {fmtPoints(projectedTotal)} pts
            </span>
            <span className="flex items-center gap-1.5 text-white/55">
              <span className="inline-block w-4 h-0 border-t-2 border-white/30" />
              Plan · {fmtPoints(plannedTotal)} pts
            </span>
          </div>
        </div>
      )}
    </button>
  )
}
