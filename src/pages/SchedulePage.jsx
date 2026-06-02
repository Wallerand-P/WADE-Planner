import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  getSortedSlots, computeStartTimes, getCurrentSlot,
  DISCIPLINE_ORDER, DISCIPLINE_META, formatDuration,
  eventLoopPoints, computePoints, fmtPoints,
} from '../lib/raceUtils'
import Layout from '../components/Layout'

export default function SchedulePage() {
  const navigate = useNavigate()
  const { roomCode, room, event, athletes, slots, upsertSlot } = useRaceStore()

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

  const points = event ? computePoints(slots, eventLoopPoints(event)) : null

  return (
    <Layout title="Schedule" roomCode={roomCode} showHome backTo={racing ? '/race' : '/planning'}>
      {sorted.length === 0 ? (
        <p className="text-white/40 text-center py-10">No schedule yet.</p>
      ) : (
        <div className="space-y-6 flex-1 animate-rise">
          {!hasClock && (
            <p className="text-xs text-white/40">
              Times are relative to the race start (set it on the Setup page for clock times).
            </p>
          )}

          {DISCIPLINE_ORDER.map(disc => {
            const dslots = sorted.filter(s => s.discipline === disc)
            if (dslots.length === 0) return null
            const m = DISCIPLINE_META[disc]
            return (
              <div key={disc}>
                <div className="flex items-center gap-2 mb-2.5 px-1">
                  <span className={`w-2.5 h-2.5 rounded-[3px] ${m.badge}`} />
                  <h2 className={`text-sm font-semibold uppercase tracking-[0.12em] ${m.text}`}>
                    {m.label}
                  </h2>
                  <span className="text-xs text-white/30 font-mono tabular-nums">
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
                        className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 border transition-colors ${
                          isCurrent
                            ? 'bg-white/[0.08] border-emerald-400/60 ring-1 ring-emerald-400/40'
                            : done
                              ? 'bg-white/[0.02] border-white/[0.05] opacity-55'
                              : 'bg-white/[0.045] border-white/10'
                        }`}
                      >
                        <span className="font-mono text-sm tabular-nums w-14 shrink-0 text-white/70">
                          {timeLabel(startTimes[slot.id])}
                        </span>
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a?.color }} />
                        <span className="flex-1 font-medium truncate">{a?.name ?? '?'}</span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full">
                            NOW
                          </span>
                        )}
                        {done && <span className="text-emerald-400 text-sm">✓</span>}
                        <span className="text-white/35 text-xs font-mono w-12 text-right shrink-0 tabular-nums">
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
            <div className="text-center text-sm text-white/45 pt-1">
              Estimated finish · <span className="font-mono text-white/80 tabular-nums">{timeLabel(finishMs)}</span>
            </div>
          )}

          {points && (
            <div className="card p-4 space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="label-eyebrow">Total points</span>
                <span className="font-mono text-3xl font-bold tabular-nums">{fmtPoints(points.total)}</span>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-white/[0.07]">
                <p className="label-eyebrow pt-3 pb-0.5">Per discipline</p>
                {DISCIPLINE_ORDER.map(d => {
                  const m = DISCIPLINE_META[d]
                  return (
                    <div key={d} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-[3px] ${m.badge}`} />
                        <span className="text-white/70">{m.label}</span>
                      </span>
                      <span className="font-mono text-white/80 tabular-nums">{fmtPoints(points.byDiscipline[d])}</span>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-1.5">
                <p className="label-eyebrow pb-0.5">Per athlete</p>
                {athletes.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                      <span className="text-white/70">{a.name}</span>
                    </span>
                    <span className="font-mono text-white/80 tabular-nums">{fmtPoints(points.byAthlete[a.id] || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}
