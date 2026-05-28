import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  getCurrentSlot, computeStartTimes, getSortedSlots,
  DISCIPLINE_META, formatCountdown, formatDuration,
} from '../lib/raceUtils'

export default function LiveRacePage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes, slots, setSlots, upsertSlot } = useRaceStore()
  const [now, setNow] = useState(Date.now())
  const [confirming, setConfirming] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [enteringFinish, setEnteringFinish] = useState(false)
  const [finishTime, setFinishTime] = useState('') // datetime-local value

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
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="text-slate-400">No active race. Check your room code.</p>
          <button onClick={() => navigate('/')} className="bg-indigo-600 rounded-xl px-6 py-3">
            Go Home
          </button>
        </div>
      </div>
    )
  }

  const raceStartMs = dayjs(room.race_start_time).valueOf()
  const raceElapsed = now - raceStartMs
  const sortedSlots = getSortedSlots(slots)
  const startTimes = computeStartTimes(slots, room.race_start_time)
  const currentSlot = getCurrentSlot(slots)
  const currentAthlete = athletes.find(a => a.id === currentSlot?.athlete_id)
  const currentMeta = currentSlot ? DISCIPLINE_META[currentSlot.discipline] : null

  const slotStartMs = currentSlot ? startTimes[currentSlot.id] : null
  const slotEndMs = currentSlot
    ? slotStartMs + Number(currentSlot.planned_duration_minutes) * 60_000
    : null
  const timeRemaining = slotEndMs ? slotEndMs - now : 0

  const currentIndex = currentSlot
    ? sortedSlots.findIndex(s => s.id === currentSlot.id)
    : sortedSlots.length
  const nextSlots = sortedSlots.slice(currentIndex + 1, currentIndex + 4)

  function startFinishEntry() {
    if (!currentSlot) return
    setFinishTime(dayjs().format('YYYY-MM-DDTHH:mm'))
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
        .update({ confirmed: true, actual_start_time: actualStartTime, actual_end_time: actualEndTime })
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
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10 flex flex-col gap-4">

        {/* Home */}
        <button
          onClick={() => navigate('/')}
          className="self-start text-slate-400 hover:text-white text-xl leading-none"
          title="Home"
        >
          ⌂
        </button>

        {/* Race clock */}
        <div className="text-center">
          <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Race Time</p>
          <p className="font-mono text-5xl font-black tabular-nums">
            {formatCountdown(raceElapsed)}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Started {dayjs(room.race_start_time).format('HH:mm')}
          </p>
        </div>

        {/* Current slot card */}
        {currentSlot && currentAthlete ? (
          <div className={`rounded-2xl p-5 border ${currentMeta.bg} ${currentMeta.border}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${currentMeta.text}`}>
              Now Racing · {currentMeta.label}
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full shrink-0 border-2 border-white/20"
                style={{ backgroundColor: currentAthlete.color }} />
              <div className="flex-1">
                <p className="text-2xl font-bold leading-tight">{currentAthlete.name}</p>
                <p className="text-slate-400 text-sm">
                  Slot {currentIndex + 1} of {sortedSlots.length}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-3xl font-bold tabular-nums ${
                  timeRemaining < 0 ? 'text-red-400' : 'text-white'
                }`}>
                  {formatCountdown(Math.abs(timeRemaining))}
                </p>
                <p className="text-xs text-slate-500">
                  {timeRemaining >= 0 ? 'remaining' : 'overtime'}
                </p>
              </div>
            </div>
            {enteringFinish ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Finished at (started {dayjs(slotStartMs).format('HH:mm')})
                  </label>
                  <input
                    type="datetime-local"
                    value={finishTime}
                    onChange={e => setFinishTime(e.target.value)}
                    className="w-full bg-slate-900/60 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  {finishTime && dayjs(finishTime).valueOf() <= slotStartMs && (
                    <p className="text-red-400 text-xs mt-1">Must be after the loop started</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmLoop}
                    disabled={confirming || dayjs(finishTime).valueOf() <= slotStartMs}
                    className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-xl py-3 font-semibold transition-colors"
                  >
                    {confirming ? 'Confirming…' : 'Confirm ✓'}
                  </button>
                  <button
                    onClick={() => setEnteringFinish(false)}
                    disabled={confirming}
                    className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-xl px-5 font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={startFinishEntry}
                className="w-full bg-green-600 hover:bg-green-500 rounded-xl py-3.5 font-semibold text-lg transition-colors"
              >
                Confirm loop done ✓
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl p-6 bg-slate-800 text-center">
            <p className="text-slate-400 text-lg font-semibold">All loops completed!</p>
            <p className="text-slate-500 text-sm mt-1">{formatCountdown(raceElapsed)} total</p>
          </div>
        )}

        {/* Pace adjustment suggestion */}
        {suggestion && (
          <div className="rounded-2xl p-4 bg-amber-900/30 border border-amber-600 space-y-3">
            <p className="text-amber-300 font-semibold text-sm">Pace adjustment suggested</p>
            <p className="text-slate-300 text-sm">
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
                className="flex-1 bg-amber-600 hover:bg-amber-500 rounded-xl py-2.5 text-sm font-semibold transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => setSuggestion(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 rounded-xl py-2.5 text-sm font-semibold transition-colors"
              >
                Keep original
              </button>
            </div>
          </div>
        )}

        {/* Up next */}
        {nextSlots.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">Up next</p>
            <div className="space-y-2">
              {nextSlots.map(slot => {
                const a = athletes.find(x => x.id === slot.athlete_id)
                const m = DISCIPLINE_META[slot.discipline]
                const timeUntilMs = startTimes[slot.id] - now
                return (
                  <div
                    key={slot.id}
                    className="bg-slate-800 rounded-xl px-4 py-3 flex items-center gap-3"
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                    <span className="flex-1 font-medium">{a?.name}</span>
                    <span className={`text-xs ${m.text}`}>{m.short}</span>
                    <span className="text-slate-400 text-sm font-mono tabular-nums">
                      {timeUntilMs > 0 ? `in ${formatCountdown(timeUntilMs)}` : 'now'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Schedule + adjust plan */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => navigate('/schedule')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl py-3 text-sm font-semibold text-slate-300 transition-colors"
          >
            📋 Schedule
          </button>
          <button
            onClick={() => navigate('/planning')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl py-3 text-sm font-semibold text-indigo-300 transition-colors"
          >
            ✎ Adjust plan
          </button>
        </div>

        {/* Room code chip */}
        <div className="flex justify-center mt-2">
          <span className="font-mono text-xs text-slate-600 bg-slate-800 px-3 py-1 rounded-full">
            {roomCode}
          </span>
        </div>
      </div>
    </div>
  )
}
