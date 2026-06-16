// Browser-side klikego fetchers. klikego serves the results pages with
// `access-control-allow-origin: *`, so the app can fetch them cross-origin
// directly. The pure parsers live in klikego.js; this just adds the network.
// (The Edge Function reuses the same parsers server-side later.)

import { parseTeamList, parseTeamDetail } from './klikego.js'

const BASE = 'https://www.klikego.com/specific/t24'

// Extract { reference, dossard, category } from a pasted klikego URL. Any of
// them may be null (e.g. a challenge link carries no dossard).
export function parseKlikegoUrl(input) {
  try {
    const q = new URL(String(input).trim()).searchParams
    return {
      reference: q.get('reference'),
      dossard: q.get('dossard'),
      category: q.get('category'),
    }
  } catch {
    return { reference: null, dossard: null, category: null }
  }
}

export async function fetchTeamList({ reference, category }) {
  const url = `${BASE}/resultats-challenge.jsp?reference=${encodeURIComponent(reference)}&category=${encodeURIComponent(category)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`klikego responded ${res.status}`)
  return parseTeamList(await res.text())
}

export async function fetchTeamDetail({ reference, dossard, category }) {
  const url = `${BASE}/detail-resultats.jsp?reference=${encodeURIComponent(reference)}&dossard=${encodeURIComponent(dossard)}&category=${encodeURIComponent(category)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`klikego responded ${res.status}`)
  return parseTeamDetail(await res.text())
}
