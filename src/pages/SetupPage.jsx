import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import {
  ATHLETE_COLORS, TEAM_SIZES, GROUP_META, eventDisciplines, paceLabel, athleteLoopMinutes,
} from '../lib/raceUtils'
import Layout from '../components/Layout'

const DEFAULT_NAMES = ['W', 'A', 'D', 'E', 'R', 'S']

function makeAthlete(i) {
  return {
    name: DEFAULT_NAMES[i] ?? `A${i + 1}`,
    color: ATHLETE_COLORS[i % ATHLETE_COLORS.length],
    swim_pace: 20,
    bike_pace: 40,
    run_pace: 30,
    bike2_pace: '',
  }
}

function defaultAthletes(n = 4) {
  return Array.from({ length: n }, (_, i) => makeAthlete(i))
}

export default function SetupPage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes: storeAthletes, setAthletes: setStoreAthletes, setRoom, setEvent } = useRaceStore()

  const [athletes, setAthletes] = useState(() =>
    storeAthletes.length > 0 ? storeAthletes : defaultAthletes()
  )
  const [raceStart, setRaceStart] = useState(
    room?.race_start_time ? room.race_start_time.slice(0, 16) : ''
  )
  const [eventId, setEventId] = useState(room?.event_id ?? '')
  const [events, setEvents] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('events').select('*').order('name')
      .then(({ data }) => setEvents(data ?? []))
  }, [])

  // Preselect the room's saved event once it loads (room hydrates async)
  useEffect(() => {
    if (room?.event_id) setEventId(room.event_id)
  }, [room?.event_id])

  const event = events.find(e => e.id === eventId) || null
  const disciplines = eventDisciplines(event)

  if (!roomCode) { navigate('/'); return null }

  function update(i, field, value) {
    setAthletes(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  function setTeamSize(n) {
    setAthletes(prev => {
      if (n <= prev.length) return prev.slice(0, n)
      const extra = Array.from({ length: n - prev.length }, (_, k) => makeAthlete(prev.length + k))
      return [...prev, ...extra]
    })
  }

  function paceCols(a) {
    return {
      swim_pace: Number(a.swim_pace),
      bike_pace: Number(a.bike_pace),
      run_pace: Number(a.run_pace),
      bike2_pace: a.bike2_pace == null || a.bike2_pace === '' ? null : Number(a.bike2_pace),
    }
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      // Remove athletes that were dropped (e.g. smaller team) and any slots
      // that referenced them, so the FK stays valid.
      const currentIds = new Set(athletes.filter(a => a.id).map(a => a.id))
      const removed = (storeAthletes || []).filter(a => a.id && !currentIds.has(a.id))
      for (const r of removed) {
        await supabase.from('schedule_slots').delete().eq('athlete_id', r.id)
        await supabase.from('athletes').delete().eq('id', r.id)
      }

      // Update existing athletes; insert new ones — positions follow the list.
      const saved = []
      for (let i = 0; i < athletes.length; i++) {
        const a = athletes[i]
        if (a.id) {
          const { error: upErr } = await supabase.from('athletes')
            .update({ name: a.name, color: a.color, position: i + 1, ...paceCols(a) })
            .eq('id', a.id)
          if (upErr) throw upErr
          saved.push({ ...a, position: i + 1 })
        } else {
          const { data, error: insErr } = await supabase.from('athletes')
            .insert({ room_code: roomCode, name: a.name, color: a.color, position: i + 1, ...paceCols(a) })
            .select().single()
          if (insErr) throw insErr
          saved.push(data)
        }
      }

      const roomUpdates = { status: 'planning', event_id: eventId || null }
      if (raceStart) roomUpdates.race_start_time = new Date(raceStart).toISOString()
      const { error: roomErr } = await supabase
        .from('rooms').update(roomUpdates).eq('code', roomCode)
      if (roomErr) throw roomErr

      setStoreAthletes(saved)
      setRoom({ ...room, ...roomUpdates })
      setEvent(event)
      navigate('/planning')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const paceCols2 = disciplines.length >= 4 ? 'grid-cols-2' : 'grid-cols-3'

  return (
    <Layout title="Setup" roomCode={roomCode} showHome>
      <div className="flex flex-col flex-1 gap-6 animate-rise">

        <div className="card px-4 py-3.5">
          <p className="text-[11px] text-white/40 mb-1">Share this code with your teammates</p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-indigo-300">{roomCode}</p>
        </div>

        <section>
          <h2 className="label-eyebrow mb-3 px-1">Event</h2>
          <select
            value={eventId}
            onChange={e => {
              const id = e.target.value
              setEventId(id)
              // Auto-fill the start time from the chosen event (still editable)
              const ev = events.find(x => x.id === id)
              if (ev?.default_start) setRaceStart(ev.default_start)
            }}
            className="input-field w-full px-4 py-3.5"
          >
            <option value="">Select an event…</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>

          {event && (
            <div className="card p-4 mt-3 space-y-2.5">
              {disciplines.map(d => (
                <div key={d.key} className="flex items-center justify-between text-sm">
                  <span className={`font-semibold ${GROUP_META[d.group].text}`}>{d.label}</span>
                  <span className="text-white/55 tabular-nums">
                    {d.km} km
                    <span className="text-white/30"> · </span>
                    <span className="text-white/80 font-medium">{Math.round(d.points * 10) / 10} pts</span>
                    <span className="text-white/35">/loop</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="label-eyebrow mb-3 px-1">Team size</h2>
          <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/10">
            {TEAM_SIZES.map(n => (
              <button
                key={n}
                onClick={() => setTeamSize(n)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                  athletes.length === n ? 'bg-indigo-500 text-white shadow-lg' : 'text-white/45 hover:text-white/80'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="label-eyebrow mb-3 px-1">Athletes &amp; paces (min / loop)</h2>
          <div className="space-y-3">
            {athletes.map((athlete, i) => (
              <div key={i} className="card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full shrink-0 ring-2 ring-white/10" style={{ backgroundColor: athlete.color }} />
                  <input
                    value={athlete.name}
                    onChange={e => update(i, 'name', e.target.value)}
                    placeholder={`Athlete ${i + 1}`}
                    className="input-field flex-1 px-3 py-2 font-semibold"
                  />
                </div>
                <div className={`grid ${paceCols2} gap-2`}>
                  {disciplines.map(d => {
                    const raw = athlete[d.paceField]
                    const isDerived = d.deriveFrom && (raw == null || raw === '')
                    const effective = athleteLoopMinutes(athlete, d, disciplines)
                    const speed = (event && d.km) ? paceLabel(d.group, effective, d.km) : null
                    return (
                      <div key={d.key}>
                        <label className={`block text-[11px] font-medium ${GROUP_META[d.group].text} mb-1`}>
                          {d.short}
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={raw ?? ''}
                          onChange={e => update(i, d.paceField, e.target.value)}
                          placeholder={isDerived ? String(effective || 'auto') : 'min'}
                          className="input-field w-full px-2 py-2 text-center text-sm tabular-nums"
                        />
                        {speed && (
                          <p className="text-xs text-white/55 text-center mt-1 tabular-nums">{speed}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="label-eyebrow mb-3 px-1">Race start time</h2>
          <input
            type="datetime-local"
            value={raceStart}
            onChange={e => setRaceStart(e.target.value)}
            className="input-field block w-full min-w-0 max-w-full appearance-none box-border px-4 py-3.5"
          />
        </section>

        {error && <p className="text-rose-400 text-sm">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="btn-primary mt-auto w-full py-4 text-lg"
        >
          {saving ? 'Saving…' : 'Continue to Planning →'}
        </button>
      </div>
    </Layout>
  )
}
