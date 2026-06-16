import { useState } from 'react'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import { parseKlikegoUrl, fetchTeamList, fetchTeamDetail } from '../lib/klikegoClient'
import { syncLiveResults } from '../lib/syncLiveResults'

// Normalise a name for fuzzy matching (lowercase, strip accents/punctuation)
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Best app-athlete guess for a klikego name (token overlap). '' if no signal —
// common, since app athletes are often placeholders (W / A / D / E).
function suggestAthleteId(klikegoName, athletes) {
  const tTokens = new Set(norm(klikegoName).split(' ').filter(Boolean))
  let best = '', bestScore = 0
  for (const a of athletes) {
    const an = norm(a.name)
    if (!an) continue
    let score = an.split(' ').filter(t => tTokens.has(t)).length * 2
    if (norm(klikegoName).includes(an) || an.includes(norm(klikegoName))) score += 1
    if (score > bestScore) { bestScore = score; best = a.id }
  }
  return bestScore > 0 ? best : ''
}

export default function LiveResultsConfig() {
  const { roomCode, room, event, athletes, slots, setRoom, setAthletes, setSlots } = useRaceStore()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [step, setStep] = useState('link') // link | team | map
  const [link, setLink] = useState('')
  const [src, setSrc] = useState(null)
  const [teams, setTeams] = useState([])
  const [filter, setFilter] = useState('')
  const [detail, setDetail] = useState(null)
  const [mapping, setMapping] = useState({}) // suffix -> athleteId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connected = !!room?.results_confirmed

  function reset() { setStep('link'); setLink(''); setSrc(null); setTeams([]); setFilter(''); setDetail(null); setMapping({}); setError('') }

  async function findTeams() {
    setError(''); setBusy(true)
    try {
      const parsed = parseKlikegoUrl(link)
      if (!parsed.reference) throw new Error('Need a klikego results link (with ?reference=…).')
      if (!parsed.category) throw new Error('That link has no category — paste a team or category results link.')
      const list = await fetchTeamList({ reference: parsed.reference, category: parsed.category })
      if (!list.length) throw new Error('No teams found at that link.')
      setSrc({ reference: parsed.reference, category: parsed.category })
      if (parsed.dossard) {
        const t = list.find(x => x.dossard === parsed.dossard)
        if (t) { setTeams(list); await pickTeam(t, { reference: parsed.reference, category: parsed.category }); return }
      }
      setTeams(list); setStep('team')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function pickTeam(t, srcOverride) {
    setError(''); setBusy(true)
    try {
      const s = srcOverride || src
      const cat = t.category || s.category
      const d = await fetchTeamDetail({ reference: s.reference, dossard: t.dossard, category: cat })
      if (!d.roster.length) throw new Error('No roster found for that team yet.')
      setDetail(d); setSrc({ ...s, dossard: t.dossard, category: cat })
      const init = {}
      for (const r of d.roster) {
        const existing = athletes.find(a => a.bib_suffix === r.suffix)
        init[r.suffix] = existing?.id ?? suggestAthleteId(r.name, athletes)
      }
      setMapping(init); setStep('map')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const used = Object.values(mapping).filter(Boolean)
  const allMapped = detail && detail.roster.every(r => mapping[r.suffix])
  const distinct = new Set(used).size === used.length
  const countOk = detail && detail.roster.length === athletes.length
  const canConfirm = allMapped && distinct && countOk && !busy

  async function confirm() {
    setError(''); setBusy(true)
    try {
      const idToSuffix = {}
      for (const [suf, id] of Object.entries(mapping)) if (id) idToSuffix[id] = Number(suf)
      const updated = []
      for (const a of athletes) {
        const suffix = idToSuffix[a.id] ?? null
        const { error: e } = await supabase.from('athletes').update({ bib_suffix: suffix }).eq('id', a.id)
        if (e) throw e
        updated.push({ ...a, bib_suffix: suffix })
      }
      const roomUpdates = {
        results_reference: src.reference, results_dossard: src.dossard,
        results_category: src.category, results_confirmed: true, results_synced_at: null,
      }
      const { error: re } = await supabase.from('rooms').update(roomUpdates).eq('code', roomCode)
      if (re) throw re
      setAthletes(updated); setRoom({ ...room, ...roomUpdates })
      setOpen(false); reset()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function disconnect() {
    setBusy(true)
    const roomUpdates = { results_reference: null, results_dossard: null, results_category: null, results_confirmed: false, results_synced_at: null }
    await supabase.from('rooms').update(roomUpdates).eq('code', roomCode)
    setRoom({ ...room, ...roomUpdates })
    setBusy(false); setOpen(false); reset()
  }

  async function syncNow() {
    setSyncing(true); setSyncMsg('')
    try {
      const r = await syncLiveResults({ room, event, athletes, slots })
      const { data } = await supabase.from('schedule_slots').select('*').eq('room_code', roomCode)
      if (data) setSlots(data)
      setRoom({ ...room, results_synced_at: r.syncedAt })
      setSyncMsg(`✓ ${r.lapCount} laps · ${r.updated} written${r.removed ? `, ${r.removed} removed` : ''}${r.skipped ? `, ${r.skipped} locked` : ''}`)
    } catch (e) { setSyncMsg('⚠ ' + e.message) } finally { setSyncing(false) }
  }

  // ---- Connected (collapsed) summary ----
  if (connected && !open) {
    return (
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-300">Live results connected</p>
            <p className="text-xs text-white/45 truncate">
              Bib {room.results_dossard} · {room.results_category}
              {room.results_synced_at
                ? ` · synced ${dayjs(room.results_synced_at).format('HH:mm:ss')}`
                : ' · not synced yet'}
            </p>
          </div>
          <button onClick={() => { setOpen(true); reset() }} className="btn-secondary px-3 py-2 text-xs shrink-0">Edit</button>
        </div>
        <button onClick={syncNow} disabled={syncing} className="btn-primary w-full py-2.5 text-sm">
          {syncing ? 'Syncing…' : '⟳ Sync now'}
        </button>
        {syncMsg && (
          <p className={`text-xs ${syncMsg.startsWith('⚠') ? 'text-rose-400' : 'text-emerald-300'}`}>{syncMsg}</p>
        )}
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); reset() }} className="card w-full p-4 flex items-center gap-3 text-left active:scale-[0.99] transition">
        <span className="text-lg">📡</span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Connect live results</p>
          <p className="text-xs text-white/45">Auto-fill loop times from the official klikego page</p>
        </div>
        <span className="text-white/30">›</span>
      </button>
    )
  }

  // ---- Editing flow ----
  return (
    <div className="card p-4 space-y-3 ring-1 ring-indigo-400/30">
      <div className="flex items-center justify-between">
        <p className="label-eyebrow">Live results · klikego</p>
        <button onClick={() => { setOpen(false); reset() }} className="text-white/40 text-sm hover:text-white">✕</button>
      </div>

      {step === 'link' && (
        <div className="space-y-2.5">
          <p className="text-xs text-white/50">Paste any klikego results link for your event (team or category page).</p>
          <input
            value={link} onChange={e => setLink(e.target.value)}
            placeholder="https://www.klikego.com/specific/t24/…"
            className="input-field w-full px-3 py-2.5 text-sm"
          />
          <button onClick={findTeams} disabled={busy || !link} className="btn-primary w-full py-2.5 text-sm">
            {busy ? 'Loading…' : 'Find my team'}
          </button>
        </div>
      )}

      {step === 'team' && (
        <div className="space-y-2.5">
          <input
            value={filter} onChange={e => setFilter(e.target.value)}
            placeholder={`Search ${teams.length} teams…`}
            className="input-field w-full px-3 py-2.5 text-sm"
          />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {teams.filter(t => norm(t.name).includes(norm(filter))).slice(0, 40).map(t => (
              <button key={t.dossard} onClick={() => pickTeam(t)} disabled={busy}
                className="card-inset w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/[0.06]">
                <span className="flex-1 text-sm font-medium truncate">{t.name}</span>
                <span className="text-[11px] text-white/35 font-mono shrink-0">#{t.dossard} · {t.points} pts</span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep('link')} className="btn-secondary w-full py-2 text-xs">← Back</button>
        </div>
      )}

      {step === 'map' && detail && (
        <div className="space-y-3">
          <div className="card-inset px-3 py-2">
            <p className="text-sm font-semibold text-emerald-300">✓ {detail.teamName}</p>
            <p className="text-xs text-white/45">{src.category} · {detail.totalPoints} pts · {detail.laps.length} laps so far</p>
          </div>
          <p className="text-xs text-white/50">Match each klikego racer to your athlete:</p>
          <div className="space-y-1.5">
            {detail.roster.map(r => (
              <div key={r.suffix} className="flex items-center gap-2">
                <span className="text-xs font-mono text-white/40 w-5 shrink-0">{r.suffix}</span>
                <span className="flex-1 text-sm truncate">{r.name}</span>
                <span className="text-white/25">→</span>
                <select
                  value={mapping[r.suffix] || ''}
                  onChange={e => setMapping(m => ({ ...m, [r.suffix]: e.target.value }))}
                  className="input-field px-2 py-1.5 text-sm w-32 shrink-0"
                >
                  <option value="">—</option>
                  {athletes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          {!countOk && (
            <p className="text-amber-400 text-xs">
              Team size mismatch: klikego has {detail.roster.length} racers, your room has {athletes.length}. They must match.
            </p>
          )}
          {countOk && !distinct && <p className="text-amber-400 text-xs">Each athlete can only map to one racer.</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep(teams.length ? 'team' : 'link')} className="btn-secondary px-4 py-2.5 text-sm">←</button>
            <button onClick={confirm} disabled={!canConfirm} className="btn-success flex-1 py-2.5 text-sm">
              {busy ? 'Saving…' : 'Confirm & enable'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-rose-400 text-xs">{error}</p>}

      {connected && step === 'link' && (
        <button onClick={disconnect} disabled={busy} className="btn-danger w-full py-2 text-xs">Disconnect live results</button>
      )}
    </div>
  )
}
