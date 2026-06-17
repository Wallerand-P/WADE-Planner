import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  getCurrentSlot, computeStartTimes, getSortedSlots,
  GROUP_META, eventDisciplines, formatCountdown, formatDuration,
} from '../lib/raceUtils'
import PointsChart from '../components/PointsChart'
import LiveResultsConfig from '../components/LiveResultsConfig'

// Compact "12s" / "3m" / "1h" age label for the freshness chip.
function formatAge(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

const STALL_MS = 5 * 60_000 // no successful sync for 5 min → fall back to manual

export default function LiveRacePage() {
  const navigate = useNavigate()
  const { roomCode, room, event, athletes, slots, setSlots, upsertSlot, setRoom } = useRaceStore()
  const [now, setNow] = useState(Date.now())
  const [confirming, setConfirming] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [enteringFinish, setEnteringFinish] = useState(false)
  const [finishTime, setFinishTime] = useState('') // datetime-local value
  const [confirmEnd, setConfirmEnd] = useState(false)

  // 1-second tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Realtime subscription for slot updates
  useEffect(() => {
    if (!roomCode) return
    const channel = supabase
      .channel(`live-${roomCode}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'schedule_slots',
        filter: `room_code=eq.${roomCode}`,
      }, payload => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          upsertSlot(payload.new)
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [roomCode, upsertSlot])

  if (!roomCode || !room?.race_start_time) {
    return (
      <div className="min-h-screen text-white flex items-center justify-center px-6">
        <div className="text-center space-y-5">
          <p className="text-white/50">No active race. Check your room code.</p>
          <button onClick={() => navigate('/')} className="btn-primary px-6 py-3">
            Go Home
          </button>
        </div>
      </div>
    )
  }

  const raceStartMs = dayjs(room.race_start_time).valueOf()
  const raceElapsed = now - raceStartMs
  const sortedSlots = getSortedSlots(slots)
  const disciplines = eventDisciplines(event)
  const startTimes = computeStartTimes(slots, room.race_start_time, disciplines)
  const currentSlot = getCurrentSlot(slots)
  const currentAthlete = athletes.find(a => a.id === currentSlot?.athlete_id)

  // Map a slot's discipline key → its info (label/short/group), with a fallback
  // so it works even before the event has loaded.
  const discByKey = Object.fromEntries(disciplines.map(d => [d.key, d]))
  const discInfo = key => {
    if (discByKey[key]) return discByKey[key]
    const group = key && key.startsWith('bike') ? 'bike' : key
    return { group, label: GROUP_META[group]?.label ?? key, short: GROUP_META[group]?.short ?? key }
  }
  const currentInfo = currentSlot ? discInfo(currentSlot.discipline) : null
  const currentMeta = currentInfo ? GROUP_META[currentInfo.group] : null

  const slotStartMs = currentSlot ? startTimes[currentSlot.id] : null
  const slotEndMs = currentSlot
    ? slotStartMs + Number(currentSlot.planned_duration_minutes) * 60_000
    : null
  const timeRemaining = slotEndMs ? slotEndMs - now : 0
  // The current loop can't begin before its discipline's structural start, so
  // it may be in a "waiting at the line" gap (ahead of schedule).
  const waiting = slotStartMs != null && now < slotStartMs
  const untilStart = waiting ? slotStartMs - now : 0

  // Authority mode (klikego is the source of truth). The cron confirms loops
  // automatically; manual confirm is hidden unless sync has stalled.
  const authority = !!room?.results_confirmed
  const syncedAtMs = room?.results_synced_at ? dayjs(room.results_synced_at).valueOf() : null
  const syncAgeMs = syncedAtMs != null ? now - syncedAtMs : null
  const stalled = authority && (syncAgeMs == null || syncAgeMs > STALL_MS)
  // Show the manual confirm button when not in Authority, or when live sync stalled.
  const showManualConfirm = !authority || stalled

  const currentIndex = currentSlot
    ? sortedSlots.findIndex(s => s.id === currentSlot.id)
    : sortedSlots.length
  const nextSlots = sortedSlots.slice(currentIndex + 1, currentIndex + 4)

  function startFinishEntry() {
    if (!currentSlot) return
    // Default to the theoretical (planned) finish time
    setFinishTime(dayjs(slotEndMs).format('YYYY-MM-DDTHH:mm'))
    setEnteringFinish(true)
  }

  async function confirmLoop() {
    if (!currentSlot || confirming) return
    const startMs = startTimes[currentSlot.id]
    const endMs = dayjs(finishTime).valueOf()
    if (!finishTime || Number.isNaN(endMs) || endMs <= startMs) return
    setConfirming(true)
    try {
      const actualEndTime = new Date(endMs).toISOString()
      const actualStartTime = new Date(startMs).toISOString()
      const actualMinutes = (endMs - startMs) / 60_000

      const { data, error } = await supabase
        .from('schedule_slots')
        // In Authority mode a manual confirm is an override — lock it so the
        // cron leaves it alone (until the user reverts to live on Planning).
        .update({
          confirmed: true, actual_start_time: actualStartTime, actual_end_time: actualEndTime,
          ...(authority ? { manual_override: true } : {}),
        })
        .eq('id', currentSlot.id)
        .select()
        .single()
      if (error) throw error
      upsertSlot(data)
      setEnteringFinish(false)

      // Suggest pace adjustment if delta ≥ 2 min
      const delta = actualMinutes - Number(currentSlot.planned_duration_minutes)
      if (Math.abs(delta) >= 2) {
        const futureSlots = sortedSlots.filter(
          s => !s.confirmed && s.id !== currentSlot.id &&
            s.athlete_id === currentSlot.athlete_id &&
            s.discipline === currentSlot.discipline
        )
        if (futureSlots.length > 0) {
          setSuggestion({ confirmedSlot: data, delta, futureSlots })
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setConfirming(false)
    }
  }

  async function endRace() {
    await supabase.from('rooms').update({ status: 'finished' }).eq('code', roomCode)
    setRoom({ ...room, status: 'finished' })
    navigate('/schedule')
  }

  async function applyAdjustment() {
    if (!suggestion) return
    const newDuration = Number(suggestion.confirmedSlot.planned_duration_minutes) + suggestion.delta
    await Promise.all(
      suggestion.futureSlots.map(s =>
        supabase.from('schedule_slots')
          .update({ planned_duration_minutes: newDuration })
          .eq('id', s.id)
      )
    )
    const { data } = await supabase
      .from('schedule_slots').select('*').eq('room_code', roomCode)
    if (data) setSlots(data)
    setSuggestion(null)
  }

  return (
    <div className="min-h-screen text-white">
      <div className="max-w-md mx-auto px-5 pt-[max(1.75rem,env(safe-area-inset-top))] pb-12 flex flex-col gap-4">

        {/* Race clock */}
        <div className="text-center py-2">
          <p className="label-eyebrow mb-1.5">Race Time</p>
          <p className="font-mono text-6xl font-bold tabular-nums tracking-tight">
            {formatCountdown(raceElapsed)}
          </p>
          <p className="text-xs text-white/35 mt-1.5">
            Started {dayjs(room.race_start_time).format('HH:mm')}
          </p>
        </div>

        {/* Not connected yet — let the user wire up live results right here,
            without going back to Planning (common right after the gun). */}
        {!authority && <LiveResultsConfig />}

        {/* Live-results freshness chip (Authority mode) */}
        {authority && (
          <div className="flex justify-center -mt-1.5">
            {stalled ? (
              <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
                ⚠ Live sync stalled{syncedAtMs != null ? ` · last ${formatAge(syncAgeMs)} ago` : ''} — confirm manually
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1 rounded-full">
                ● Live · synced {formatAge(syncAgeMs)} ago
              </span>
            )}
          </div>
        )}

        {/* Plan vs reality points chart (rooms launched before snapshots have none) */}
        {room.plan_snapshot && (
          <PointsChart
            snapshot={room.plan_snapshot}
            slots={slots}
            raceStartTime={room.race_start_time}
            disciplines={disciplines}
            now={now}
          />
        )}

        {/* Current slot card */}
        {currentSlot && currentAthlete ? (
          <div className="card p-5 relative overflow-hidden">
            <div className={`absolute inset-x-0 top-0 h-[3px] ${currentMeta.badge}`} />
            <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] mb-4 ${waiting ? 'text-sky-300' : currentMeta.text}`}>
              {waiting ? '◷ Starting soon' : '● Now Racing'} · {currentInfo.label}
            </p>
            <div className="flex items-center gap-3.5 mb-5">
              <div className="w-12 h-12 rounded-full shrink-0 ring-2 ring-white/15"
                style={{ backgroundColor: currentAthlete.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-bold leading-tight tracking-tight truncate">{currentAthlete.name}</p>
                <p className="text-white/40 text-sm">
                  Slot {currentIndex + 1} of {sortedSlots.length}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-3xl font-bold tabular-nums ${
                  waiting ? 'text-sky-300' : timeRemaining < 0 ? 'text-rose-400' : 'text-white'
                }`}>
                  {formatCountdown(waiting ? untilStart : Math.abs(timeRemaining))}
                </p>
                <p className="text-[11px] text-white/40">
                  {waiting ? 'until start' : timeRemaining >= 0 ? 'remaining' : 'overtime'}
                </p>
              </div>
            </div>
            {enteringFinish ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-white/45">
                      Finished at (started {dayjs(slotStartMs).format('HH:mm')})
                    </label>
                    <button
                      onClick={() => setFinishTime(dayjs().format('YYYY-MM-DDTHH:mm'))}
                      className="text-xs font-semibold text-indigo-300 hover:text-indigo-200 active:scale-95 transition"
                    >
                      Set to now
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={finishTime}
                    onChange={e => setFinishTime(e.target.value)}
                    className="input-field block w-full min-w-0 max-w-full appearance-none box-border px-3 py-2.5 focus:ring-emerald-400/60"
                  />
                  {finishTime && dayjs(finishTime).valueOf() <= slotStartMs && (
                    <p className="text-rose-400 text-xs mt-1.5">Must be after the loop started</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmLoop}
                    disabled={confirming || dayjs(finishTime).valueOf() <= slotStartMs}
                    className="btn-success flex-1 py-3"
                  >
                    {confirming ? 'Confirming…' : 'Confirm ✓'}
                  </button>
                  <button onClick={() => setEnteringFinish(false)} disabled={confirming} className="btn-secondary px-5">
                    Cancel
                  </button>
                </div>
              </div>
            ) : showManualConfirm ? (
              <button onClick={startFinishEntry} className="btn-success w-full py-3.5 text-lg">
                Confirm loop done ✓
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-center gap-2 py-2.5 text-sm text-white/55">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Awaiting live result…
                </div>
                <button onClick={startFinishEntry} className="w-full py-2 text-xs text-white/45 hover:text-white/70 transition">
                  Correct manually
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <p className="text-xl font-bold tracking-tight">All loops completed</p>
            <p className="text-white/40 text-sm mt-1.5 font-mono tabular-nums">{formatCountdown(raceElapsed)} total</p>
          </div>
        )}

        {/* Pace adjustment suggestion */}
        {suggestion && (
          <div className="rounded-3xl p-4 bg-amber-500/[0.08] border border-amber-500/30 space-y-3">
            <p className="text-amber-300 font-semibold text-sm">Pace adjustment suggested</p>
            <p className="text-white/70 text-sm">
              This loop was{' '}
              <span className="font-semibold">{formatDuration(Math.abs(suggestion.delta))}</span>{' '}
              {suggestion.delta > 0 ? 'slower' : 'faster'} than planned.
              Update the remaining{' '}
              <span className="font-semibold">{suggestion.futureSlots.length}</span>{' '}
              {suggestion.confirmedSlot.discipline} loop(s) for{' '}
              <span className="font-semibold">
                {athletes.find(a => a.id === suggestion.confirmedSlot.athlete_id)?.name}
              </span>{' '}
              to{' '}
              <span className="font-semibold">
                {formatDuration(
                  Number(suggestion.confirmedSlot.planned_duration_minutes) + suggestion.delta
                )}
              </span>
              /loop?
            </p>
            <div className="flex gap-2">
              <button
                onClick={applyAdjustment}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-black rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
              >
                Apply
              </button>
              <button onClick={() => setSuggestion(null)} className="btn-secondary flex-1 py-2.5 text-sm">
                Keep original
              </button>
            </div>
          </div>
        )}

        {/* Up next */}
        {nextSlots.length > 0 && (
          <div>
            <p className="label-eyebrow mb-2 px-1">Up next</p>
            <div className="space-y-2">
              {nextSlots.map(slot => {
                const a = athletes.find(x => x.id === slot.athlete_id)
                const info = discInfo(slot.discipline)
                const m = GROUP_META[info.group]
                const timeUntilMs = startTimes[slot.id] - now
                return (
                  <div key={slot.id} className="card-inset px-4 py-3 flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                    <span className="flex-1 font-medium truncate">{a?.name}</span>
                    <span className={`text-xs ${m.text}`}>{info.short}</span>
                    <span className="text-white/45 text-sm font-mono tabular-nums">
                      {timeUntilMs > 0 ? `in ${formatCountdown(timeUntilMs)}` : 'now'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Schedule + adjust plan */}
        <div className="flex gap-2.5 mt-2">
          <button onClick={() => navigate('/schedule')} className="btn-secondary flex-1 py-3 text-sm">
            📋 Schedule
          </button>
          <button onClick={() => navigate('/planning')} className="btn-secondary flex-1 py-3 text-sm text-indigo-200">
            ✎ Adjust plan
          </button>
        </div>

        {/* Home */}
        <button onClick={() => navigate('/')} className="btn-secondary w-full py-3 text-sm">
          ⌂ Home
        </button>

        {/* End race */}
        {confirmEnd ? (
          <div className="card p-4 space-y-3 ring-1 ring-rose-500/40">
            <p className="text-sm text-white/70">End the race for everyone? You can still view the final schedule afterwards.</p>
            <div className="flex gap-2">
              <button
                onClick={endRace}
                className="flex-1 bg-rose-500 hover:bg-rose-400 text-white rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
              >
                End race
              </button>
              <button onClick={() => setConfirmEnd(false)} className="btn-secondary flex-1 py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className="btn-danger w-full py-3 text-sm">
            End race
          </button>
        )}

        {/* Room code chip */}
        <div className="flex justify-center mt-2">
          <span className="font-mono text-[11px] text-white/35 bg-white/[0.05] border border-white/10 px-3 py-1 rounded-full tracking-[0.2em]">
            {roomCode}
          </span>
        </div>
      </div>
    </div>
  )
}
