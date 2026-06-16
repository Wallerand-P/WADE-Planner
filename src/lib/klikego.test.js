import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseTeamDetail, parseTeamList, hmsToSec } from './klikego.js'

const detailHtml = readFileSync(
  fileURLToPath(new URL('./__fixtures__/klikego-detail.html', import.meta.url)), 'utf8')
const listHtml = readFileSync(
  fileURLToPath(new URL('./__fixtures__/klikego-list.html', import.meta.url)), 'utf8')

describe('hmsToSec', () => {
  it('parses HH:MM:SS and MM:SS', () => {
    expect(hmsToSec('00:24:02')).toBe(1442)
    expect(hmsToSec('00:44:00')).toBe(2640)
    expect(hmsToSec('2:24')).toBe(144)
  })
  it('returns null on garbage', () => {
    expect(hmsToSec('')).toBeNull()
    expect(hmsToSec('abc')).toBeNull()
  })
})

describe('parseTeamDetail (Rupture du frein fixture)', () => {
  const r = parseTeamDetail(detailHtml)

  it('reads team header', () => {
    expect(r.teamName).toBe('RUPTURE DU FREIN')
    expect(r.dossard).toBe('6105')
    expect(r.totalPoints).toBe(876)
  })

  it('reads the full 6-athlete roster in suffix order', () => {
    expect(r.roster).toEqual([
      { suffix: 1, name: 'Victor ABSIL' },
      { suffix: 2, name: 'Thomas BRUWAENE' },
      { suffix: 3, name: 'Pierre-louis GAULTIER' },
      { suffix: 4, name: 'Caroline MOUGEOT' },
      { suffix: 5, name: 'Paul PERRIN' },
      { suffix: 6, name: 'Gonzague TOKUSHIGE' },
    ])
  })

  it('reads the four discipline sections with km + points', () => {
    expect(r.disciplines).toEqual([
      { name: 'Natation', km: 1.0, points: 15 },
      { name: 'Vélo', km: 21.0, points: 21 },
      { name: 'Vélo 2', km: 16.0, points: 16 },
      { name: 'Course', km: 6.8, points: 27 },
    ])
  })

  it('reads all 44 laps with the right per-discipline counts', () => {
    expect(r.laps).toHaveLength(44)
    const counts = r.laps.reduce((acc, l) => ((acc[l.discipline] = (acc[l.discipline] || 0) + 1), acc), {})
    expect(counts).toEqual({ Natation: 11, Vélo: 8, 'Vélo 2': 12, Course: 13 })
  })

  it('decodes the first two swim laps (split + running cumulative)', () => {
    expect(r.laps[0]).toEqual({ discipline: 'Natation', tour: 1, suffix: 5, splitSec: 1442, cumSec: 1442 })
    expect(r.laps[1]).toEqual({ discipline: 'Natation', tour: 2, suffix: 6, splitSec: 1198, cumSec: 2640 })
  })

  it('confirms cumulative resets at each discipline (Vélo 2 first lap cum == its split)', () => {
    const velo2 = r.laps.filter(l => l.discipline === 'Vélo 2')
    expect(velo2[0].cumSec).toBe(velo2[0].splitSec)
    expect(velo2[0].cumSec).toBe(hmsToSec('00:24:27'))
  })

  it('every lap suffix is a known roster member', () => {
    const known = new Set(r.roster.map(a => a.suffix))
    expect(r.laps.every(l => known.has(l.suffix))).toBe(true)
  })
})

describe('parseTeamList (EQ-6 fixture)', () => {
  const teams = parseTeamList(listHtml)

  it('finds many teams', () => {
    expect(teams.length).toBeGreaterThan(100)
  })

  it('resolves Rupture du frein → dossard 6105', () => {
    const t = teams.find(x => x.dossard === '6105')
    expect(t).toMatchObject({ dossard: '6105', name: 'RUPTURE DU FREIN', category: 'EQ-6', points: 876 })
  })

  it('dossards are unique', () => {
    const d = teams.map(t => t.dossard)
    expect(new Set(d).size).toBe(d.length)
  })
})
