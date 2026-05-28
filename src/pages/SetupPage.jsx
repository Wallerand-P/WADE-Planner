import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import { ATHLETE_COLORS } from '../lib/raceUtils'
import Layout from '../components/Layout'

const PACE_FIELDS = [
  { key: 'swim_pace', label: 'Swim', color: 'text-blue-400' },
  { key: 'bike_pace', label: 'Bike', color: 'text-amber-400' },
  { key: 'run_pace',  label: 'Run',  color: 'text-emerald-400' },
]

const DEFAULT_NAMES = ['W', 'A', 'D', 'E']

function defaultAthletes() {
  return DEFAULT_NAMES.map((name, i) => ({
    name,
    color: ATHLETE_COLORS[i],
    swim_pace: 20,
    bike_pace: 40,
    run_pace: 30,
  }))
}

export default function SetupPage() {
  const navigate = useNavigate()
  const { roomCode, room, athletes: storeAthletes, setAthletes: setStoreAthletes, setRoom } = useRaceStore()

  const [athletes, setAthletes] = useState(() =>
    storeAthletes.length > 0 ? storeAthletes : defaultAthletes()
  )
  const [raceStart, setRaceStart] = useState(
    room?.race_start_time ? room.race_start_time.slice(0, 16) : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!roomCode) { navigate('/'); return null }

  function update(i, field, value) {
    setAthletes(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const hasIds = athletes.some(a => a.id)

      let saved
      if (hasIds) {
        // Update existing athletes
        await Promise.all(
          athletes.map(a =>
            supabase.from('athletes').update({
              name: a.name,
              color: a.color,
              swim_pace: Number(a.swim_pace),
              bike_pace: Number(a.bike_pace),
              run_pace: Number(a.run_pace),
            }).eq('id', a.id)
          )
        )
        saved = athletes
      } else {
        // First time — insert all
        const { data, error: insertErr } = await supabase
          .from('athletes')
          .insert(
            athletes.map((a, i) => ({
              room_code: roomCode,
              name: a.name,
              color: a.color,
              position: i + 1,
              swim_pace: Number(a.swim_pace),
              bike_pace: Number(a.bike_pace),
              run_pace: Number(a.run_pace),
            }))
          )
          .select()
        if (insertErr) throw insertErr
        saved = data
      }

      const roomUpdates = { status: 'planning' }
      if (raceStart) roomUpdates.race_start_time = new Date(raceStart).toISOString()
      const { error: roomErr } = await supabase
        .from('rooms').update(roomUpdates).eq('code', roomCode)
      if (roomErr) throw roomErr

      setStoreAthletes(saved)
      setRoom({ ...room, ...roomUpdates })
      navigate('/planning')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout title="Setup" roomCode={roomCode} showHome>
      <div className="flex flex-col flex-1 gap-6 animate-rise">

        <div className="card px-4 py-3.5">
          <p className="text-[11px] text-white/40 mb-1">Share this code with your teammates</p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-indigo-300">{roomCode}</p>
        </div>

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
                <div className="grid grid-cols-3 gap-2">
                  {PACE_FIELDS.map(({ key, label, color }) => (
                    <div key={key}>
                      <label className={`block text-[11px] font-medium ${color} mb-1`}>{label}</label>
                      <input
                        type="number"
                        min={1}
                        value={athlete[key]}
                        onChange={e => update(i, key, e.target.value)}
                        className="input-field w-full px-2 py-2 text-center text-sm tabular-nums"
                      />
                    </div>
                  ))}
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
            className="input-field w-full px-4 py-3.5"
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
