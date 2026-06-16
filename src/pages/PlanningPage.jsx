import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  GROUP_META, eventDisciplines, athleteLoopMinutes,
  getSortedSlots, getScheduledMinutes, formatDuration, computeDisciplineBudgets,
  computeStartTimes, eventLoopPoints, fmtPoints,
} from '../lib/raceUtils'
import { generatePlan } from '../lib/generatePlan'
import Layout from '../components/Layout'
import LiveResultsConfig from '../components/LiveResultsConfig'

export default function PlanningPage() {
  const navigate = useNavigate()
  const { roomCode, room, event, athletes, slots, setSlots, upsertSlot, removeSlot, setRoom } = useRaceStore()

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

  // Launch dialog
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launchTime, setLaunchTime] = useState('')

  const racing = room?.status === 'racing'
  const disciplines = eventDisciplines(event)
  const activeDisc = disciplines.find(d => d.key === activeTab) || disciplines[0]
  const meta = GROUP_META[activeDisc.group]
  const disciplineSlots = getSortedSlots(slots).filter(s => s.discipline === activeDisc.key)
  const scheduled = getScheduledMinutes(slots, activeDisc.key)

  // Available time per discipline, accounting for boundary overruns cascading
  // from earlier disciplines (a swim that runs past its window shrinks cycling).
  const { budgets } = computeDisciplineBudgets(slots, disciplines)
  const total = budgets[activeDisc.key]
  const nominal = activeDisc.window.end - activeDisc.window.start

  const loopPts = event ? eventLoopPoints(event) : null
  const disciplinePoints = loopPts ? disciplineSlots.length * loopPts[activeDisc.key] : null
  const remaining = total - scheduled

  // Boundary flags, anchored on real progress: projected start times (with the
  // structural-start floor + confirmed actuals) vs each discipline's cut-off.
  // A loop is only a problem when it would START after the cut-off — a loop
  // already underway at the cut-off is fine and still counts, so running past
  // the line is NOT flagged.
  const baseMs = dayjs(room?.race_start_time || 0).valueOf()
  const startTimes = computeStartTimes(slots, room?.race_start_time || 0, disciplines)
  const startsAfterCutoff = (slot, disc) => {
    const startMs = startTimes[slot.id]
    return startMs != null && startMs >= baseMs + disc.window.end * 60_000
  }
  // Whether each discipline has any too-late loops (for the tab markers)
  const overflowByDisc = Object.fromEntries(
    disciplines.map(d => [
      d.key,
      getSortedSlots(slots).some(s => s.discipline === d.key && startsAfterCutoff(s, d)),
    ])
  )
  // Spare room before the active discipline's cut-off → how many more loops can
  // still START in time. A loop only needs to begin before the cut-off (it may
  // finish over the line), so the last valid start can sit just shy of it.
  const cutoffMin = activeDisc.window.end
  const cutoffMs = baseMs + cutoffMin * 60_000
  const lastDiscSlot = disciplineSlots[disciplineSlots.length - 1]
  const nextStartMs = lastDiscSlot
    ? startTimes[lastDiscSlot.id] + Number(lastDiscSlot.planned_duration_minutes) * 60_000
    : baseMs + activeDisc.window.start * 60_000
  const repLoopMin = disciplineSlots.length
    ? Math.min(...disciplineSlots.map(s => Number(s.planned_duration_minutes)))
    : null
  const roomForMore = repLoopMin && nextStartMs < cutoffMs
    ? Math.floor((cutoffMs - nextStartMs - 1) / (repLoopMin * 60_000)) + 1
    : 0
  const lateCount = disciplineSlots.filter(s => startsAfterCutoff(s, activeDisc)).length

  // Minutes scheduled per athlete in the active discipline
  const volumeByAthlete = athletes.map(a => {
    let mins = 0
    for (const s of slots) {
      if (s.athlete_id === a.id && s.discipline === activeDisc.key) mins += Number(s.planned_duration_minutes)
    }
    return { ...a, mins }
  })

  // Auto-fill duration when athlete or tab changes
  useEffect(() => {
    if (!selAthlete && athletes.length > 0) {
      setSelAthlete(athletes[0].id)
    }
  }, [athletes, selAthlete])

  useEffect(() => {
    const a = athletes.find(x => x.id === selAthlete)
    if (a) setSelDuration(String(athleteLoopMinutes(a, activeDisc, disciplines)))
  }, [selAthlete, activeTab, athletes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active tab valid when the event (and its disciplines) changes
  useEffect(() => {
    if (!disciplines.some(d => d.key === activeTab)) setActiveTab(disciplines[0].key)
  }, [disciplines, activeTab])

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

  // Athlete who did the last loop of the discipline before `disc` (or null)
  function previousDisciplineLastAthlete(disc) {
    const idx = disciplines.findIndex(d => d.key === disc.key)
    if (idx <= 0) return null
    const prevKey = disciplines[idx - 1].key
    const prevSlots = getSortedSlots(slots).filter(s => s.discipline === prevKey)
    return prevSlots.length > 0 ? prevSlots[prevSlots.length - 1].athlete_id : null
  }

  async function autoFill() {
    setConfirmAutoFill(false)
    setAutoFilling(true)
    setError('')
    try {
      const loopMin = a => athleteLoopMinutes(a, activeDisc, disciplines)
      const planAthletes = athletes.map(a => ({
        id: a.id,
        name: a.name,
        loopDuration: loopMin(a),
      }))
      const order = generatePlan(
        planAthletes,
        { totalDuration: computeDisciplineBudgets(slots, disciplines).budgets[activeDisc.key] },
        previousDisciplineLastAthlete(activeDisc)
      )

      // Replace this discipline's slots with the generated plan
      await supabase.from('schedule_slots').delete().eq('room_code', roomCode).eq('discipline', activeDisc.key)
      const rows = order.map((athleteId, i) => ({
        room_code: roomCode,
        discipline: activeDisc.key,
        slot_order: i + 1,
        athlete_id: athleteId,
        planned_duration_minutes: loopMin(athletes.find(a => a.id === athleteId)),
      }))
      const { data, error: err } = rows.length
        ? await supabase.from('schedule_slots').insert(rows).select()
        : { data: [], error: null }
      if (err) throw err

      setSlots([...slots.filter(s => s.discipline !== activeDisc.key), ...data])
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
          discipline: activeDisc.key,
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

  function openLaunch() {
    setLaunchTime(
      room?.race_start_time
        ? dayjs(room.race_start_time).format('YYYY-MM-DDTHH:mm')
        : dayjs().format('YYYY-MM-DDTHH:mm')
    )
    setLaunchOpen(true)
  }

  async function confirmLaunch() {
    if (!launchTime) return
    const iso = new Date(launchTime).toISOString()
    // Freeze the plan as the baseline for the plan-vs-reality chart.
    // Re-launching overwrites the previous snapshot (re-baselines).
    const snapshot = {
      start: iso,
      points: event ? eventLoopPoints(event) : null,
      slots: getSortedSlots(slots).map(s => ({
        discipline: s.discipline,
        minutes: Number(s.planned_duration_minutes),
      })),
    }
    const updates = { status: 'racing', race_start_time: iso, plan_snapshot: snapshot }
    const { error: err } = await supabase
      .from('rooms').update(updates).eq('code', roomCode)
    if (!err) {
      setRoom({ ...room, ...updates })
      navigate('/race')
    }
  }

  const allFilled = disciplines.every(
    d => getScheduledMinutes(slots, d.key) >= budgets[d.key] - 5
  )

  return (
    <Layout title="Planning" roomCode={roomCode} showHome backTo={room?.status === 'racing' ? '/race' : '/setup'}>
      {/* Live results connection (klikego) */}
      <div className="mb-5">
        <LiveResultsConfig />
      </div>

      {/* Discipline tabs */}
      <div className="flex gap-1 p-1 mb-5 rounded-2xl bg-white/[0.04] border border-white/10">
        {disciplines.map(d => {
          const m = GROUP_META[d.group]
          const done = getScheduledMinutes(slots, d.key) >= budgets[d.key] - 5
          const active = activeDisc.key === d.key
          return (
            <button
              key={d.key}
              onClick={() => switchTab(d.key)}
              className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                active ? `${m.badge} text-white shadow-lg` : 'text-white/45 hover:text-white/80'
              }`}
            >
              {d.short}{overflowByDisc[d.key] ? ' ⚠' : done ? ' ✓' : ''}
            </button>
          )
        })}
      </div>

      {/* Progress card */}
      <div className="card p-4 mb-4">
        <div className="flex justify-between items-baseline mb-2.5">
          <div className="flex items-baseline gap-2">
            <span className={`font-semibold ${meta.text}`}>{activeDisc.label}</span>
            {disciplinePoints != null && (
              <span className="text-xs font-mono text-white/45 tabular-nums">
                {fmtPoints(disciplinePoints)} pts
              </span>
            )}
          </div>
          <span className={`text-sm ${
            remaining < 0 ? 'text-rose-400' : remaining === 0 ? 'text-emerald-400' : 'text-white/55'
          }`}>
            {remaining < 0
              ? `${formatDuration(remaining)} over`
              : remaining === 0
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
          {formatDuration(scheduled)} of {formatDuration(total)} available
          {total < nominal && (
            <span className="text-amber-400/80">
              {' '}· {formatDuration(nominal - total)} lost to overrun
            </span>
          )}
        </p>

        {/* Boundary advisory — user adjusts the plan manually */}
        {lateCount > 0 ? (
          <p className="text-xs text-rose-300/90 mt-1.5">
            ⚠ {lateCount} loop{lateCount > 1 ? 's' : ''} can't start before the {formatDuration(cutoffMin)} cut-off — trim or move
          </p>
        ) : roomForMore >= 1 ? (
          <p className="text-xs text-sky-300/90 mt-1.5">
            ↗ Room for ~{roomForMore} more loop{roomForMore > 1 ? 's' : ''} before {formatDuration(cutoffMin)}
          </p>
        ) : null}

        {/* Per-athlete volume in this discipline */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3.5 pt-3.5 border-t border-white/[0.07]">
          {volumeByAthlete.map(v => (
            <div key={v.id} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-white/70">{v.name}</span>
              <span className="text-white/35 font-mono tabular-nums">{formatDuration(v.mins)}</span>
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
                {startsAfterCutoff(slot, activeDisc) && (
                  <span
                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 bg-rose-500/20 text-rose-300"
                    title={`Starts after the ${formatDuration(cutoffMin)} cut-off`}
                  >
                    past
                  </span>
                )}
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
            Replace the {disciplineSlots.length} existing {activeDisc.label.toLowerCase()} slot(s) with an
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
          {autoFilling ? 'Generating…' : `✨ Auto-fill ${activeDisc.label}`}
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
        <button onClick={openLaunch} disabled={!allFilled} className="btn-success w-full mt-4 py-4 text-lg">
          {allFilled ? 'Launch Race →' : 'Fill all disciplines to launch'}
        </button>
      )}

      {/* Launch dialog — confirm / adjust the start time before racing */}
      {launchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6 bg-black/60 backdrop-blur-sm"
          onClick={() => setLaunchOpen(false)}
        >
          <div className="card w-full max-w-sm p-5 space-y-4 animate-rise" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-bold tracking-tight">Start the race</h3>
              <p className="text-sm text-white/50 mt-1">
                This start time anchors the whole schedule. Keep the planned time, start now, or pick another.
              </p>
            </div>

            <div>
              <label className="label-eyebrow block mb-1.5">Race start</label>
              <input
                type="datetime-local"
                value={launchTime}
                onChange={e => setLaunchTime(e.target.value)}
                className="input-field block w-full min-w-0 max-w-full appearance-none box-border px-4 py-3"
              />
            </div>

            <button
              onClick={() => setLaunchTime(dayjs().format('YYYY-MM-DDTHH:mm'))}
              className="btn-secondary w-full py-2.5 text-sm"
            >
              ⦿ Start now
            </button>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setLaunchOpen(false)} className="btn-secondary flex-1 py-3">
                Cancel
              </button>
              <button onClick={confirmLaunch} disabled={!launchTime} className="btn-success flex-1 py-3">
                Launch →
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
