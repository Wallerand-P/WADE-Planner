// Pure parsers for klikego T24 results pages. No I/O — callers fetch the HTML
// (browser or Deno) and pass the string in. These stay faithful to klikego's
// own structure (French discipline labels, per-discipline cumulative); mapping
// klikego sections → app disciplines happens in the reconciler, not here.
//
// See docs/live-results-sync.md for the page structure and the decision record.

// "HH:MM:SS" or "MM:SS" → seconds. Returns null on garbage.
export function hmsToSec(str) {
  if (!str) return null
  const parts = String(str).trim().split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

// Strip tags/entities/whitespace from a snippet of HTML.
function text(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Drop <script>/<style> so their contents never leak into matches.
function clean(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
}

/**
 * Parse a team's detail page.
 * Returns { teamName, dossard, category, totalPoints, roster, disciplines, laps }
 *   roster:      [{ suffix, name }]
 *   disciplines: [{ name, km, points }]              (klikego section order)
 *   laps:        [{ discipline, tour, suffix, splitSec, cumSec }]
 *                 `discipline` is the klikego section name the lap falls under;
 *                 `cumSec` is cumulative *within that discipline* (it resets).
 */
export function parseTeamDetail(html) {
  const h = clean(html)

  const teamName = (h.match(/Classement de\s+([^<]+?)\s*\.?\s*</) || [])[1]?.trim() || null
  const totalPoints = numOrNull((h.match(/(\d[\d\s]*)\s*PTS/i) || [])[1])

  // First bib seen fixes the team's dossard (e.g. 6105 from "N°6105-5").
  const dossard = (h.match(/N°(\d+)-\d+/) || [])[1] || null
  const category = (h.match(/\b(EQ-?\d+|EQ\d+-[A-Z])\b/) || [])[1]?.replace(/^EQ(\d)/, 'EQ-$1') || null

  // Roster: <b>[wave ]<bib>-<suffix></b> / Full Name</div>
  const roster = []
  const rosterRe = /\b\d{2,}-(\d+)<\/b>\s*\/\s*([^<]+?)<\/div>/g
  let rm
  while ((rm = rosterRe.exec(h))) {
    const suffix = Number(rm[1])
    const name = text(rm[2])
    if (name && !roster.some(r => r.suffix === suffix)) roster.push({ suffix, name })
  }
  roster.sort((a, b) => a.suffix - b.suffix)

  // Discipline section headers, in document (chronological) order.
  const disciplines = []
  const headRe = /<b>([^<]+?)<\/b>\s*-\s*<small>\s*Distance\s*([\d.]+)\s*km\s*\/\s*(\d+)\s*Points/gi
  let dm
  const headerPositions = []
  while ((dm = headRe.exec(h))) {
    disciplines.push({ name: dm[1].trim(), km: Number(dm[2]), points: Number(dm[3]) })
    headerPositions.push({ name: dm[1].trim(), idx: dm.index })
  }

  // Lap lines, each attributed to the discipline header that precedes it.
  const laps = []
  const lapRe = /TOUR\s*(\d+)\s*\/\s*N°\d+-(\d+)[\s\S]*?<b>\s*([\d:]+)\s*\/\s*([\d:]+)\s*<\/b>/g
  let lm
  while ((lm = lapRe.exec(h))) {
    const before = headerPositions.filter(p => p.idx < lm.index)
    const discipline = before.length ? before[before.length - 1].name : null
    laps.push({
      discipline,
      tour: Number(lm[1]),
      suffix: Number(lm[2]),
      splitSec: hmsToSec(lm[3]),
      cumSec: hmsToSec(lm[4]),
    })
  }

  return { teamName, dossard, category, totalPoints, roster, disciplines, laps }
}

/**
 * Parse an event/category results-list page → the teams, for resolving a
 * team name to its dossard. Returns [{ rank, name, dossard, category, points }].
 */
export function parseTeamList(html) {
  const h = clean(html)
  const teams = []
  const rowRe =
    /dossard=(\d+)&category=([^"&]+)[^"]*"[^>]*>\s*(?:<b>)?\s*([^<]+?)\s*(?:<\/b>)?\s*<\/a>[\s\S]{0,200}?(\d[\d\s]*)\s*pts/gi
  let m
  while ((m = rowRe.exec(h))) {
    teams.push({
      dossard: m[1],
      category: m[2],
      name: text(m[3]).replace(/\s*\.\s*$/, ''),
      points: numOrNull(m[4]),
    })
  }
  return teams
}

function numOrNull(s) {
  if (s == null) return null
  const n = Number(String(s).replace(/\s/g, ''))
  return Number.isNaN(n) ? null : n
}
