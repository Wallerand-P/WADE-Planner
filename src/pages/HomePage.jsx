import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRaceStore } from '../store/raceStore'
import { generateRoomCode } from '../lib/raceUtils'

export default function HomePage() {
  const navigate = useNavigate()
  const {
    setRoomCode, setRoom, setAthletes, setSlots,
    recentRooms, addRecentRoom, removeRecentRoom,
  } = useRaceStore()
  const [roomName, setRoomName] = useState('')
  const [creatingMode, setCreatingMode] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createRoom() {
    const name = roomName.trim()
    if (!name) { setError('Please name your room'); return }
    setLoading(true)
    setError('')
    try {
      const code = generateRoomCode()
      const { error: err } = await supabase.from('rooms').insert({ code, name, status: 'setup' })
      if (err) throw err
      setRoomCode(code)
      setRoom({ code, name, status: 'setup', race_start_time: null })
      setAthletes([])
      setSlots([])
      addRecentRoom({ code, name })
      navigate('/setup')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function enterRoom(rawCode) {
    const code = rawCode.toUpperCase().trim()
    if (code.length < 4) { setError('Enter a valid room code'); return }
    setLoading(true)
    setError('')
    try {
      const { data: room, error: roomErr } = await supabase
        .from('rooms').select('*').eq('code', code).single()
      if (roomErr || !room) {
        removeRecentRoom(code)
        throw new Error('Room not found')
      }

      const [{ data: athletes }, { data: slots }] = await Promise.all([
        supabase.from('athletes').select('*').eq('room_code', code).order('position'),
        supabase.from('schedule_slots').select('*').eq('room_code', code),
      ])

      setRoomCode(code)
      setRoom(room)
      setAthletes(athletes ?? [])
      setSlots(slots ?? [])
      addRecentRoom({ code: room.code, name: room.name })

      if (room.status === 'racing') navigate('/race')
      else if (room.status === 'planning') navigate('/planning')
      else if (room.status === 'finished') navigate('/schedule')
      else navigate('/setup')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-white flex items-center justify-center px-6 py-12">
      <svg aria-hidden className="home-liquid" viewBox="0 0 400 640" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="wadeLiquid" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#070610" />
            <stop offset="26%" stopColor="#15102a" />
            <stop offset="45%" stopColor="#553494" />
            <stop offset="56%" stopColor="#c33f1e" />
            <stop offset="65%" stopColor="#511610" />
            <stop offset="100%" stopColor="#060510" />
          </linearGradient>
          <filter id="wadeWarp" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.009 0.014" numOctaves="3" seed="11" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="185" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <rect x="-80" y="-80" width="560" height="800" fill="url(#wadeLiquid)" filter="url(#wadeWarp)" />
      </svg>
      <div aria-hidden className="home-grain" />
      <div aria-hidden className="home-scrim" />
      <div className="relative z-10 w-full max-w-sm space-y-9 animate-rise">
        <div className="text-center">
          <h1 className="text-[64px] leading-none font-black tracking-tightest bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
            WADE
          </h1>
          <p className="mt-3 text-sm text-white/45 tracking-wide">T24 Relay Planner</p>
        </div>

        <div className="space-y-4">
          {creatingMode ? (
            <div className="space-y-3">
              <input
                autoFocus
                value={roomName}
                onChange={e => setRoomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRoom()}
                placeholder="Room name"
                maxLength={40}
                className="input-field w-full px-4 py-4 text-center text-lg"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={createRoom}
                  disabled={loading || !roomName.trim()}
                  className="btn-primary flex-1 py-4 text-lg"
                >
                  {loading ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={() => { setCreatingMode(false); setRoomName(''); setError('') }}
                  disabled={loading}
                  className="btn-secondary px-5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setError(''); setCreatingMode(true) }}
              className="btn-primary w-full py-4 text-lg"
            >
              Create Room
            </button>
          )}

          <div className="flex items-center gap-3 text-white/30">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs tracking-wide">or join</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div className="flex gap-2.5">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && enterRoom(joinCode)}
              placeholder="ROOM CODE"
              maxLength={8}
              className="input-field flex-1 min-w-0 px-4 py-4 text-center font-mono text-xl tracking-[0.3em]"
            />
            <button
              onClick={() => enterRoom(joinCode)}
              disabled={loading}
              className="btn-secondary shrink-0 px-5"
            >
              Join
            </button>
          </div>

          {error && <p className="text-rose-400 text-sm text-center">{error}</p>}
        </div>

        {recentRooms.length > 0 && (
          <div className="space-y-2.5">
            <p className="label-eyebrow px-1">Your rooms</p>
            {recentRooms.map(r => (
              <div
                key={r.code}
                className="card-inset flex items-center transition-colors hover:bg-white/[0.055]"
              >
                <button
                  onClick={() => enterRoom(r.code)}
                  disabled={loading}
                  className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 text-left disabled:opacity-50"
                >
                  <span className="flex-1 min-w-0 font-medium truncate">{r.name || 'Untitled room'}</span>
                  <span className="font-mono text-[11px] text-white/40 tracking-[0.2em] shrink-0">{r.code}</span>
                </button>
                <button
                  onClick={() => removeRecentRoom(r.code)}
                  className="shrink-0 w-10 h-10 mr-1 flex items-center justify-center rounded-full text-white/30 hover:text-rose-300 hover:bg-white/[0.06] transition-all"
                  title="Forget this room"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
