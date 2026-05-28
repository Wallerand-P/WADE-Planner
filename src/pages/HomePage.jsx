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
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createRoom() {
    setLoading(true)
    setError('')
    try {
      const code = generateRoomCode()
      const name = roomName.trim()
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
      else navigate('/setup')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-5xl font-black tracking-tighter mb-2">WADE</h1>
          <p className="text-slate-400">T24 Relay Planner</p>
        </div>

        <div className="space-y-4">
          <input
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            placeholder="Room name (optional)"
            maxLength={40}
            className="w-full bg-slate-800 rounded-2xl px-4 py-3.5 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-2xl py-4 font-semibold text-lg transition-colors"
          >
            {loading ? 'Creating…' : 'Create Room'}
          </button>

          <div className="flex items-center gap-3 text-slate-600">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-sm">or join</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && enterRoom(joinCode)}
              placeholder="ROOM CODE"
              maxLength={8}
              className="flex-1 bg-slate-800 rounded-2xl px-4 py-4 text-center font-mono text-xl tracking-widest placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={() => enterRoom(joinCode)}
              disabled={loading}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-2xl px-5 font-semibold transition-colors"
            >
              Join
            </button>
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>

        {recentRooms.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your rooms</p>
            {recentRooms.map(r => (
              <div
                key={r.code}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              >
                <button
                  onClick={() => enterRoom(r.code)}
                  disabled={loading}
                  className="flex-1 flex items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
                >
                  <span className="flex-1 font-medium truncate">{r.name || 'Untitled room'}</span>
                  <span className="font-mono text-xs text-slate-500 tracking-widest">{r.code}</span>
                </button>
                <button
                  onClick={() => removeRecentRoom(r.code)}
                  className="px-3 py-3 text-slate-500 hover:text-red-300 transition-colors"
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
