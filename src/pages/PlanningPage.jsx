import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  DISCIPLINE_ORDER, DISCIPLINE_DURATIONS, DISCIPLINE_META,
  getSortedSlots, getScheduledMinutes, formatDuration,
} from '../lib/raceUtils'
import { generatePlan } from '../lib/generatePlan'
import Layout from '../components/Layout'

export default function PlanningPage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes, slots, setSlots, upsertSlot, removeSlot, setRoom } = useRaceStore()

  const [activeTab, setActiveTab] = useState('swim')
  const [selAthlete, setSelAthlete] = useState('')
  const [selDuration, setSelDuration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Inline slot editing
  const [editingId, setEditingId] = useState(null)
  const [editAthlete, setEditAthlete] = useState('')
  const [editDuration, setEditDuration] = useState('')

  // Auto-fill
  const [autoFilling, setAutoFilling] = useState(false)
  const [confirmAutoFill, setConfirmAutoFill] = useState(false)

  const racing = room?.status === 'racing'
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

  // Keep the plan in sync across phones in real time
  useEffect(() => {
    if (!roomCode) return
    const channel = supabase
      .channel(`planning-${roomCode}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'schedule_slots',
        filter: `room_code=eq.${roomCode}`,
      }, payload => {
        if (payload.eventType === 'DELETE') removeSlot(payload.old.id)
        else upsertSlot(payload.new)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [roomCode, upsertSlot, removeSlot])

  if (!roomCode) { navigate('/'); return null }

  function switchTab(d) {
    setActiveTab(d)
    setConfirmAutoFill(false)
  }

  // Athlete who did the last loop of the discipline before `discipline` (or null)
  function previousDisciplineLastAthlete(discipline) {
    const idx = DISCIPLINE_ORDER.indexOf(discipline)
    if (idx <= 0) return null
    const prevSlots = getSortedSlots(slots).filter(s => s.discipline === DISCIPLINE_ORDER[idx - 1])
    return prevSlots.length > 0 ? prevSlots[prevSlots.length - 1].athlete_id : null
  }

  async function autoFill() {
    setConfirmAutoFill(false)
    setAutoFilling(true)
    setError('')
    try {
      const planAthletes = athletes.map(a => ({
        id: a.id,
        name: a.name,
        loopDuration: Number(a[`${activeTab}_pace`]),
      }))
      const order = generatePlan(
        planAthletes,
        { totalDuration: DISCIPLINE_DURATIONS[activeTab] },
        previousDisciplineLastAthlete(activeTab)
      )

      // Replace this discipline's slots with the generated plan
      await supabase.from('schedule_slots').delete().eq('room_code', roomCode).eq('discipline', activeTab)
      const rows = order.map((athleteId, i) => ({
        room_code: roomCode,
        discipline: activeTab,
        slot_order: i + 1,
        athlete_id: athleteId,
        planned_duration_minutes: Number(athletes.find(a => a.id === athleteId)[`${activeTab}_pace`]),
      }))
      const { data, error: err } = rows.length
        ? await supabase.from('schedule_slots').insert(rows).select()
        : { data: [], error: null }
      if (err) throw err

      setSlots([...slots.filter(s => s.discipline !== activeTab), ...data])
    } catch (e) {
      setError(e.message)
    } finally {
      setAutoFilling(false)
    }
  }

  function onAutoFillClick() {
    if (racing) return
    if (disciplineSlots.length > 0) setConfirmAutoFill(true)
    else autoFill()
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

  async function reloadSlots() {
    const { data } = await supabase.from('schedule_slots').select('*').eq('room_code', roomCode)
    if (data) setSlots(data)
  }

  async function deleteSlot(slot) {
    if (editingId === slot.id) setEditingId(null)
    removeSlot(slot.id)
    await supabase.from('schedule_slots').delete().eq('id', slot.id)
    // Re-sequence remaining slots in this discipline so orders stay 1..n
    const remaining = disciplineSlots.filter(s => s.id !== slot.id)
    await Promise.all(
      remaining
        .map((s, idx) =>
          s.slot_order === idx + 1
            ? null
            : supabase.from('schedule_slots').update({ slot_order: idx + 1 }).eq('id', s.id)
        )
        .filter(Boolean)
    )
    await reloadSlots()
  }

  async function moveSlot(slot, direction) {
    const idx = disciplineSlots.findIndex(s => s.id === slot.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= disciplineSlots.length) return
    const other = disciplineSlots[swapIdx]
    await Promise.all([
      supabase.from('schedule_slots').update({ slot_order: other.slot_order }).eq('id', slot.id),
      supabase.from('schedule_slots').update({ slot_order: slot.slot_order }).eq('id', other.id),
    ])
    await reloadSlots()
  }

  function startEdit(slot) {
    setEditingId(slot.id)
    setEditAthlete(slot.athlete_id)
    setEditDuration(String(slot.planned_duration_minutes))
  }

  async function saveEdit(slot) {
    if (!editAthlete || !editDuration) return
    const { data, error: err } = await supabase
      .from('schedule_slots')
      .update({ athlete_id: editAthlete, planned_duration_minutes: Number(editDuration) })
      .eq('id', slot.id)
      .select()
      .single()
    if (err) { setError(err.message); return }
    upsertSlot(data)
    setEditingId(null)
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
    <Layout title="Planning" roomCode={roomCode} showHome backTo={room?.status === 'racing' ? '/race' : '/setup'}>
      {/* Discipline tabs */}
      <div className="flex gap-1 p-1 mb-5 rounded-2xl bg-white/[0.04] border border-white/10">
        {DISCIPLINE_ORDER.map(d => {
          const m = DISCIPLINE_META[d]
          const done = getScheduledMinutes(slots, d) >= DISCIPLINE_DURATIONS[d] - 5
          const active = activeTab === d
          return (
            <button
              key={d}
              onClick={() => switchTab(d)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                active ? `${m.badge} text-white shadow-lg` : 'text-white/45 hover:text-white/80'
              }`}
            >
              {m.short}{done ? ' ✓' : ''}
            </button>
          )
        })}
      </div>

      {/* Progress card */}
      <div className="card p-4 mb-4">
        <div className="flex justify-between items-baseline mb-2.5">
          <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
          <span className={`text-sm ${remaining <= 0 ? 'text-emerald-400' : 'text-white/55'}`}>
            {remaining <= 0
              ? '✓ Fully scheduled'
              : `${formatDuration(remaining)} remaining`}
          </span>
        </div>
        {/* Stacked bar — one segment per slot, colored by athlete */}
        <div className="w-full bg-white/10 rounded-full h-2.5 flex overflow-hidden">
          {disciplineSlots.map((slot, i) => {
            const a = athletes.find(x => x.id === slot.athlete_id)
            const pct = (Number(slot.planned_duration_minutes) / total) * 100
            return (
              <div
                key={slot.id}
                className={`h-full ${i < disciplineSlots.length - 1 ? 'border-r border-black/30' : ''}`}
                style={{ width: `${pct}%`, backgroundColor: a?.color }}
              />
            )
          })}
        </div>
        <p className="text-xs text-white/35 mt-2 tabular-nums">
          {formatDuration(scheduled)} of {formatDuration(total)} target
        </p>

        {/* Per-athlete volume in this discipline */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3.5 pt-3.5 border-t border-white/[0.07]">
          {volumeByAthlete.map(v => (
            <div key={v.id} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-white/70">{v.name}</span>
              <span className="text-white/35 font-mono tabular-nums">{formatDuration(v.byDisc[activeTab])}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Slot list */}
      <div className="flex-1 space-y-2 mb-4 min-h-[80px]">
        {disciplineSlots.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-6">
            No slots yet — add the first one below.
          </p>
        ) : (
          disciplineSlots.map((slot, i) => {
            const a = athletes.find(x => x.id === slot.athlete_id)
            const isEditing = editingId === slot.id

            if (isEditing) {
              return (
                <div key={slot.id} className="card-inset p-3 space-y-2.5 ring-2 ring-indigo-400/60">
                  <div className="flex gap-2">
                    <select
                      value={editAthlete}
                      onChange={e => setEditAthlete(e.target.value)}
                      className="input-field flex-1 px-3 py-2"
                    >
                      {athletes.map(x => (
                        <option key={x.id} value={x.id}>{x.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={editDuration}
                        onChange={e => setEditDuration(e.target.value)}
                        className="input-field w-16 px-2 py-2 text-center tabular-nums"
                      />
                      <span className="text-white/35 text-xs">min</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(slot)} className="btn-primary flex-1 py-2 text-sm">Save</button>
                    <button onClick={() => setEditingId(null)} className="btn-secondary flex-1 py-2 text-sm">Cancel</button>
                  </div>
                </div>
              )
            }

            const btn = 'w-7 h-7 flex items-center justify-center rounded-lg text-white/45 transition-all active:scale-90 disabled:opacity-20 disabled:cursor-not-allowed'
            return (
              <div key={slot.id} className="card-inset pl-3 pr-2 py-2 flex items-center gap-2">
                <span className="text-white/30 text-sm w-4 shrink-0 tabular-nums">{i + 1}</span>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                <span className="flex-1 font-medium truncate">{a?.name ?? '?'}</span>
                <span className="text-white/45 text-sm font-mono mr-1 tabular-nums">
                  {formatDuration(slot.planned_duration_minutes)}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => moveSlot(slot, 'up')} disabled={i === 0} className={`${btn} hover:bg-white/10 hover:text-white`} title="Move up">↑</button>
                  <button onClick={() => moveSlot(slot, 'down')} disabled={i === disciplineSlots.length - 1} className={`${btn} hover:bg-white/10 hover:text-white`} title="Move down">↓</button>
                  <button onClick={() => startEdit(slot)} className={`${btn} hover:bg-white/10 hover:text-white`} title="Edit">✎</button>
                  <button onClick={() => deleteSlot(slot)} className={`${btn} hover:bg-rose-500/20 hover:text-rose-300`} title="Delete">✕</button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add slot panel */}
      <div className="card p-4 space-y-3">
        <p className="label-eyebrow">Add next slot</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={selAthlete}
            onChange={e => setSelAthlete(e.target.value)}
            className="input-field px-3 py-3"
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
              className="input-field w-full px-3 py-3 text-center tabular-nums"
            />
            <span className="text-white/35 text-xs shrink-0">min</span>
          </div>
        </div>
        <button
          onClick={addSlot}
          disabled={saving || !selAthlete || !selDuration}
          className="btn-primary w-full py-3"
        >
          + Add Slot
        </button>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
      </div>

      {/* Auto-fill (disabled once the race has started) */}
      {racing ? (
        <p className="w-full mt-4 text-center text-xs text-white/30">
          Auto-fill is disabled during the race
        </p>
      ) : confirmAutoFill ? (
        <div className="card p-4 mt-4 space-y-3 ring-2 ring-indigo-400/50">
          <p className="text-sm text-white/70">
            Replace the {disciplineSlots.length} existing {meta.label.toLowerCase()} slot(s) with an
            auto-generated plan?
          </p>
          <div className="flex gap-2">
            <button onClick={autoFill} disabled={autoFilling} className="btn-primary flex-1 py-2.5 text-sm">
              {autoFilling ? 'Generating…' : 'Replace'}
            </button>
            <button onClick={() => setConfirmAutoFill(false)} className="btn-secondary flex-1 py-2.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onAutoFillClick}
          disabled={autoFilling}
          className="btn-secondary w-full mt-4 py-3 text-sm text-indigo-200"
        >
          {autoFilling ? 'Generating…' : `✨ Auto-fill ${meta.label}`}
        </button>
      )}

      {/* Full schedule */}
      <button
        onClick={() => navigate('/schedule')}
        className="btn-secondary w-full mt-3 py-3 text-sm"
      >
        📋 Full schedule
      </button>

      {/* Launch / resume button */}
      {room?.status === 'racing' ? (
        <button onClick={() => navigate('/race')} className="btn-success w-full mt-4 py-4 text-lg">
          Resume race →
        </button>
      ) : (
        <button onClick={launchRace} disabled={!allFilled} className="btn-success w-full mt-4 py-4 text-lg">
          {allFilled ? 'Launch Race →' : 'Fill all disciplines to launch'}
        </button>
      )}
    </Layout>
  )
}
