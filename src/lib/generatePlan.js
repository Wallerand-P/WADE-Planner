/**
 * Auto-fill the rotation order for a single discipline.
 *
 * Pure and deterministic: same inputs always return the same ordered array of
 * athlete ids (one id per loop). No side effects, no randomness.
 *
 * Two phases:
 *   1. Optimal loop counts — each athlete's number of loops is proportional to
 *      their speed (equivalently, every athlete races roughly equal *time*:
 *      idealᵢ = (totalDuration / n) / loopDurationᵢ). Faster athletes therefore
 *      get more loops. Fractions are resolved with largest-remainder rounding,
 *      then capped so no athlete needs more loops than can be spaced apart
 *      (an athlete can do at most others+1 loops without going back-to-back).
 *   2. Gap-based ordering — the loops are laid out spacing each athlete evenly:
 *      the athlete with the most loops left to place goes first, ties broken by
 *      the largest gap since their previous loop, then by speed.
 *
 * @param {{id: string, name?: string, loopDuration: number}[]} athletes
 *        loopDuration in minutes; lower = faster.
 * @param {{totalDuration: number}} discipline  totalDuration in minutes.
 * @param {string|null} [previousDisciplineLastAthlete]
 *        Athlete who did the last loop of the previous discipline. They may not
 *        take the very first loop of this discipline.
 * @returns {string[]} ordered athlete ids, e.g. ['A','B','C','A','D',...]
 */
export function generatePlan(athletes, discipline, previousDisciplineLastAthlete = null) {
  if (!Array.isArray(athletes) || athletes.length === 0) return []
  const totalDuration = discipline?.totalDuration ?? 0
  if (totalDuration <= 0) return []

  const n = athletes.length

  // --- Phase 1: optimal loop counts (proportional to speed = equal racing time) ---
  const ideal = athletes.map(a => (totalDuration / n) / a.loopDuration)
  const base = ideal.map(Math.floor)
  const targetTotal = Math.round(ideal.reduce((s, x) => s + x, 0))

  const counts = {}
  athletes.forEach((a, i) => { counts[a.id] = base[i] })

  // Distribute the leftover loops by largest fractional part, then faster, then order.
  let remainder = targetTotal - base.reduce((s, x) => s + x, 0)
  const byFraction = athletes
    .map((a, i) => ({ id: a.id, i, frac: ideal[i] - base[i], dur: a.loopDuration }))
    .sort((x, y) => y.frac - x.frac || x.dur - y.dur || x.i - y.i)
  for (let k = 0; remainder > 0; k++, remainder--) {
    counts[byFraction[k % n].id] += 1
  }

  // Feasibility: no athlete may have more loops than (everyone else + 1), otherwise
  // a no-back-to-back ordering is impossible. Shift any excess to the least-loaded.
  const totalLoops = () => athletes.reduce((s, a) => s + counts[a.id], 0)
  const sortedByLoad = () =>
    [...athletes].sort((x, y) => counts[y.id] - counts[x.id] || athletes.indexOf(x) - athletes.indexOf(y))
  for (let guard = 0; guard < 1000; guard++) {
    const loaded = sortedByLoad()
    const maxA = loaded[0]
    const others = totalLoops() - counts[maxA.id]
    if (counts[maxA.id] <= others + 1) break
    counts[maxA.id] -= 1
    counts[loaded[loaded.length - 1].id] += 1
  }

  // --- Phase 2: gap-based ordering of the loops ---
  const remaining = { ...counts }
  const lastPos = {}
  athletes.forEach(a => { lastPos[a.id] = null })
  const total = totalLoops()
  const sequence = []

  for (let pos = 0; pos < total; pos++) {
    const last = sequence.length > 0 ? sequence[sequence.length - 1] : null

    const eligible = athletes.filter(a => {
      if (remaining[a.id] <= 0) return false          // no loops left to place
      if (a.id === last) return false                  // no back-to-back
      if (sequence.length === 0 &&
          previousDisciplineLastAthlete != null &&
          a.id === previousDisciplineLastAthlete) return false // can't open the discipline
      return true
    })

    if (eligible.length === 0) break

    eligible.sort((x, y) => {
      // 1. most loops left to place (keeps the busy athletes well distributed)
      if (remaining[x.id] !== remaining[y.id]) return remaining[y.id] - remaining[x.id]
      // 2. largest gap since last loop (never placed = Infinity)
      const gapX = lastPos[x.id] === null ? Infinity : pos - lastPos[x.id]
      const gapY = lastPos[y.id] === null ? Infinity : pos - lastPos[y.id]
      if (gapX !== gapY) return gapY - gapX
      // 3. faster, then stable input order
      if (x.loopDuration !== y.loopDuration) return x.loopDuration - y.loopDuration
      return athletes.indexOf(x) - athletes.indexOf(y)
    })

    const chosen = eligible[0]
    sequence.push(chosen.id)
    remaining[chosen.id] -= 1
    lastPos[chosen.id] = pos
  }

  return sequence
}
