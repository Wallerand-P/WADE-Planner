import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  DISCIPLINE_ORDER, DISCIPLINE_DURATIONS, DISCIPLINE_META,
  getSortedSlots, getScheduledMinutes, formatDuration,
} from '../lib/raceUtils'
import Layout from '../components/Layout'

export default function PlanningPage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes, slots, setSlots, upsertSlot, removeSlot, setRoom } = useRaceStore()

  const [activeTab, setActiveTab] = useState('swim')
  const [selAthlete, setSelAthlete] = useState('')
  const [selDuration, setSelDuration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const meta = DISCIPLINE_META[activeTab]
  const disciplineSlots = getSortedSlots(slots).filter(s => s.discipline === activeTab)
  const scheduled = getScheduledMinutes(slots, activeTab)
  const total = DISCIPLINE_DURATIONS[activeTab]
  const remaining = total - scheduled

  // Cumulative volume per athlete (overall + per discipline)
  const volumeByAthlete = athletes.map(a => {
    const byDisc = { swim: 0, bike: 0, run: 0 }
    for (const s of slots) {
      if (s.athlete_id === a.id) byDisc[s.discipline] += Number(s.planned_duration_minutes)
    }
    return { ...a, byDisc, total: byDisc.swim + byDisc.bike + byDisc.run }
  })

  // Auto-fill duration when athlete or tab changes
  useEffect(() => {
    if (!selAthlete && athletes.length > 0) {
      setSelAthlete(athletes[0].id)
    }
  }, [athletes, selAthlete])

  useEffect(() => {
    const a = athletes.find(x => x.id === selAthlete)
    if (a) setSelDuration(String(a[`${activeTab}_pace`]))
  }, [selAthlete, activeTab, athletes])

  if (!roomCode) { navigate('/'); return null }

  function switchTab(d) {
    setActiveTab(d)
  }

  async function addSlot() {
    if (!selAthlete || !selDuration) return
    setSaving(true)
    setError('')
    try {
      const nextOrder = disciplineSlots.length + 1
      const { data, error: err } = await supabase
        .from('schedule_slots')
        .insert({
          room_code: roomCode,
          discipline: activeTab,
          slot_order: nextOrder,
          athlete_id: selAthlete,
          planned_duration_minutes: Number(selDuration),
        })
        .select()
        .single()
      if (err) throw err
      upsertSlot(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeLastSlot() {
    const last = disciplineSlots[disciplineSlots.length - 1]
    if (!last) return
    const { error: err } = await supabase.from('schedule_slots').delete().eq('id', last.id)
    if (!err) removeSlot(last.id)
  }

  async function launchRace() {
    const { error: err } = await supabase
      .from('rooms').update({ status: 'racing' }).eq('code', roomCode)
    if (!err) {
      setRoom({ ...room, status: 'racing' })
      navigate('/race')
    }
  }

  const allFilled = DISCIPLINE_ORDER.every(
    d => getScheduledMinutes(slots, d) >= DISCIPLINE_DURATIONS[d] - 5
  )

  return (
    <Layout title="Planning" roomCode={roomCode} showBack>
      {/* Discipline tabs */}
      <div className="flex gap-2 mb-5">
        {DISCIPLINE_ORDER.map(d => {
          const m = DISCIPLINE_META[d]
          const done = getScheduledMinutes(slots, d) >= DISCIPLINE_DURATIONS[d] - 5
          const active = activeTab === d
          return (
            <button
              key={d}
              onClick={() => switchTab(d)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                active ? `${m.badge} text-white` : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {m.short} {done ? '✓' : ''}
            </button>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className={`rounded-xl p-4 mb-4 ${meta.bg}`}>
        <div className="flex justify-between items-baseline mb-2">
          <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
          <span className={`text-sm ${remaining <= 0 ? 'text-green-400' : 'text-slate-300'}`}>
            {remaining <= 0
              ? '✓ Fully scheduled'
              : `${formatDuration(remaining)} remaining`}
          </span>
        </div>
        {/* Stacked bar — one segment per slot, colored by athlete */}
        <div className="w-full bg-slate-700 rounded-full h-2.5 flex overflow-hidden">
          {disciplineSlots.map((slot, i) => {
            const a = athletes.find(x => x.id === slot.athlete_id)
            const pct = (Number(slot.planned_duration_minutes) / total) * 100
            return (
              <div
                key={slot.id}
                className={`h-full ${i < disciplineSlots.length - 1 ? 'border-r border-slate-900/40' : ''}`}
                style={{ width: `${pct}%`, backgroundColor: a?.color }}
              />
            )
          })}
        </div>
        <p className="text-xs text-slate-500 mt-1.5">
          {formatDuration(scheduled)} of {formatDuration(total)} target
        </p>

        {/* Per-athlete volume in this discipline */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {volumeByAthlete.map(v => (
            <div key={v.id} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-slate-300">{v.name}</span>
              <span className="text-slate-500 font-mono">{formatDuration(v.byDisc[activeTab])}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Slot list */}
      <div className="flex-1 space-y-2 mb-4 min-h-[80px]">
        {disciplineSlots.length === 0 ? (
          <p className="text-slate-600 text-sm text-center py-6">
            No slots yet — add the first one below.
          </p>
        ) : (
          disciplineSlots.map((slot, i) => {
            const a = athletes.find(x => x.id === slot.athlete_id)
            return (
              <div key={slot.id} className="bg-slate-800 rounded-lg px-4 py-3 flex items-center gap-3">
                <span className="text-slate-600 text-sm w-5 shrink-0">{i + 1}</span>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                <span className="flex-1 font-medium">{a?.name ?? '?'}</span>
                <span className="text-slate-400 text-sm font-mono">
                  {formatDuration(slot.planned_duration_minutes)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Add slot panel */}
      <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-300">Add next slot</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={selAthlete}
            onChange={e => setSelAthlete(e.target.value)}
            className="bg-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {athletes.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={selDuration}
              onChange={e => setSelDuration(e.target.value)}
              placeholder="min"
              className="w-full bg-slate-700 rounded-xl px-3 py-3 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-slate-500 text-xs shrink-0">min</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addSlot}
            disabled={saving || !selAthlete || !selDuration}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl py-3 font-semibold transition-colors"
          >
            + Add Slot
          </button>
          {disciplineSlots.length > 0 && (
            <button
              onClick={removeLastSlot}
              className="bg-slate-700 hover:bg-red-900/60 rounded-xl px-4 text-slate-400 transition-colors"
              title="Remove last slot"
            >
              ✕
            </button>
          )}
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>

      {/* Launch button */}
      <button
        onClick={launchRace}
        disabled={!allFilled}
        className={`w-full mt-4 rounded-2xl py-4 font-semibold text-lg transition-colors ${
          allFilled
            ? 'bg-green-600 hover:bg-green-500'
            : 'bg-slate-800 text-slate-600 cursor-not-allowed'
        }`}
      >
        {allFilled ? 'Launch Race →' : 'Fill all disciplines to launch'}
      </button>
    </Layout>
  )
}
