import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  getSortedSlots, computeStartTimes, getCurrentSlot,
  DISCIPLINE_ORDER, DISCIPLINE_META, formatDuration,
} from '../lib/raceUtils'
import Layout from '../components/Layout'

export default function SchedulePage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes, slots, upsertSlot } = useRaceStore()

  // Stay in sync as loops are confirmed / the plan is edited
  useEffect(() => {
    if (!roomCode) return
    const channel = supabase
      .channel(`schedule-${roomCode}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'schedule_slots',
        filter: `room_code=eq.${roomCode}`,
      }, payload => {
        if (payload.eventType !== 'DELETE') upsertSlot(payload.new)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [roomCode, upsertSlot])

  if (!roomCode) { navigate('/'); return null }

  const racing = room?.status === 'racing'
  const hasClock = !!room?.race_start_time
  const baseMs = hasClock ? dayjs(room.race_start_time).valueOf() : 0
  const startTimes = computeStartTimes(slots, hasClock ? room.race_start_time : 0)
  const currentSlot = racing ? getCurrentSlot(slots) : null
  const sorted = getSortedSlots(slots)
  const athleteById = Object.fromEntries(athletes.map(a => [a.id, a]))

  const timeLabel = ms =>
    hasClock ? dayjs(ms).format('HH:mm') : '+' + formatDuration((ms - baseMs) / 60000)

  const lastSlot = sorted[sorted.length - 1]
  const finishMs = lastSlot
    ? startTimes[lastSlot.id] + Number(lastSlot.planned_duration_minutes) * 60000
    : null

  return (
    <Layout title="Schedule" roomCode={roomCode} showHome backTo={racing ? '/race' : '/planning'}>
      {sorted.length === 0 ? (
        <p className="text-slate-500 text-center py-10">No schedule yet.</p>
      ) : (
        <div className="space-y-5 flex-1">
          {!hasClock && (
            <p className="text-xs text-slate-500">
              Times are relative to the race start (set it on the Setup page for clock times).
            </p>
          )}

          {DISCIPLINE_ORDER.map(disc => {
            const dslots = sorted.filter(s => s.discipline === disc)
            if (dslots.length === 0) return null
            const m = DISCIPLINE_META[disc]
            return (
              <div key={disc}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-sm ${m.badge}`} />
                  <h2 className={`text-sm font-semibold uppercase tracking-wider ${m.text}`}>
                    {m.label}
                  </h2>
                  <span className="text-xs text-slate-500 font-mono">
                    from {timeLabel(startTimes[dslots[0].id])}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {dslots.map(slot => {
                    const a = athleteById[slot.athlete_id]
                    const isCurrent = currentSlot?.id === slot.id
                    const done = slot.confirmed
                    return (
                      <div
                        key={slot.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                          isCurrent
                            ? 'bg-slate-700 ring-2 ring-green-500'
                            : done
                              ? 'bg-slate-800/50 opacity-60'
                              : 'bg-slate-800'
                        }`}
                      >
                        <span className="font-mono text-sm tabular-nums w-14 shrink-0 text-slate-300">
                          {timeLabel(startTimes[slot.id])}
                        </span>
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                        <span className="flex-1 font-medium truncate">{a?.name ?? '?'}</span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold text-green-400 bg-green-500/15 px-2 py-0.5 rounded-full">
                            NOW
                          </span>
                        )}
                        {done && <span className="text-green-400 text-sm">✓</span>}
                        <span className="text-slate-500 text-xs font-mono w-12 text-right shrink-0">
                          {formatDuration(slot.planned_duration_minutes)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {finishMs && (
            <div className="text-center text-sm text-slate-400 pt-1">
              Estimated finish · <span className="font-mono text-slate-200">{timeLabel(finishMs)}</span>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}
