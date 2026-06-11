import { describe, it, expect } from 'vitest'
import { generatePlan } from './generatePlan'

// Helpers -------------------------------------------------------------------

const noBackToBack = seq => seq.every((id, i) => i === 0 || id !== seq[i - 1])

const counts = seq =>
  seq.reduce((acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }), {})

// Test fixtures -------------------------------------------------------------

const equalAthletes = [
  { id: 'A', name: 'Ana', loopDuration: 30 },
  { id: 'B', name: 'Ben', loopDuration: 30 },
  { id: 'C', name: 'Cal', loopDuration: 30 },
  { id: 'D', name: 'Dee', loopDuration: 30 },
]

const variedAthletes = [
  { id: 'A', name: 'Ana', loopDuration: 20 }, // 2x faster than the rest
  { id: 'B', name: 'Ben', loopDuration: 40 },
  { id: 'C', name: 'Cal', loopDuration: 40 },
  { id: 'D', name: 'Dee', loopDuration: 40 },
]

const discipline = { totalDuration: 240 }

// Tests ---------------------------------------------------------------------

describe('generatePlan', () => {
  it('case 1: 4 athletes with equal speed', () => {
    const seq = generatePlan(equalAthletes, discipline, null)
    console.log('Case 1 (equal speed):', seq.join(' '))

    // fastestLoops = floor(240 / 30) = 8
    expect(seq).toHaveLength(8)
    expect(seq).toEqual(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])
    expect(noBackToBack(seq)).toBe(true)
    // perfectly balanced
    expect(counts(seq)).toEqual({ A: 2, B: 2, C: 2, D: 2 })
  })

  it('case 2: 4 athletes with very different speeds (one 2x faster)', () => {
    const seq = generatePlan(variedAthletes, discipline, null)
    console.log('Case 2 (one 2x faster):', seq.join(' '))

    expect(noBackToBack(seq)).toBe(true)
    // first loop goes to the fastest athlete
    expect(seq[0]).toBe('A')
    const c = counts(seq)
    // the 2x-faster athlete does strictly more loops than each of the others
    expect(c.A).toBeGreaterThan(c.B)
    expect(c.A).toBeGreaterThan(c.C)
    expect(c.A).toBeGreaterThan(c.D)
  })

  it('case 3: previousDisciplineLastAthlete is the fastest athlete', () => {
    const seq = generatePlan(variedAthletes, discipline, 'A')
    console.log('Case 3 (prev = fastest A):', seq.join(' '))

    expect(noBackToBack(seq)).toBe(true)
    // A must NOT open the discipline...
    expect(seq[0]).not.toBe('A')
    // ...but still races the most loops overall
    const c = counts(seq)
    expect(c.A).toBeGreaterThan(c.B)
  })

  it('solo team: one athlete does every loop (back-to-back allowed)', () => {
    const solo = [{ id: 'A', loopDuration: 30 }]
    const seq = generatePlan(solo, discipline, null) // 240 / 30 = 8 loops
    console.log('Solo:', seq.join(' '))
    expect(seq).toEqual(['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'])
  })

  it('solo team still fills even if they closed the previous discipline', () => {
    const solo = [{ id: 'A', loopDuration: 30 }]
    const seq = generatePlan(solo, discipline, 'A')
    expect(seq).toHaveLength(8)
    expect(seq.every(id => id === 'A')).toBe(true)
  })

  it('duo team: alternates with no back-to-back', () => {
    const duo = [{ id: 'A', loopDuration: 30 }, { id: 'B', loopDuration: 30 }]
    const seq = generatePlan(duo, discipline, null)
    console.log('Duo:', seq.join(' '))
    expect(seq).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'])
    expect(noBackToBack(seq)).toBe(true)
  })

  it('six athletes: balanced, no back-to-back', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => ({ id, loopDuration: 30 }))
    const seq = generatePlan(six, discipline, null)
    console.log('Six:', seq.join(' '))
    expect(noBackToBack(seq)).toBe(true)
    expect(seq).toHaveLength(8)
  })

  it('is pure and deterministic (same inputs -> same output)', () => {
    const a = generatePlan(variedAthletes, discipline, 'A')
    const b = generatePlan(variedAthletes, discipline, 'A')
    expect(a).toEqual(b)
  })

  it('handles edge cases without throwing', () => {
    expect(generatePlan([], discipline, null)).toEqual([])
    expect(generatePlan(equalAthletes, { totalDuration: 0 }, null)).toEqual([])
    // total shorter than a single loop -> no loops
    expect(generatePlan(equalAthletes, { totalDuration: 10 }, null)).toEqual([])
  })
})
