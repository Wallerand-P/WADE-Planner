import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useRaceStore } from './store/raceStore'
import HomePage from './pages/HomePage'
import SetupPage from './pages/SetupPage'
import PlanningPage from './pages/PlanningPage'
import LiveRacePage from './pages/LiveRacePage'
import SchedulePage from './pages/SchedulePage'

// Rehydrates store on refresh and subscribes to room status changes so all
// phones navigate together when the room moves to planning or racing.
function RoomSync() {
  const navigate = useNavigate()
  const { roomCode, athletes, setRoom, setAthletes, setSlots, clearRoom } = useRaceStore()

  useEffect(() => {
    if (!roomCode) return

    async function load() {
      const [{ data: room }, { data: aths }, { data: slots }] = await Promise.all([
        supabase.from('rooms').select('*').eq('code', roomCode).single(),
        supabase.from('athletes').select('*').eq('room_code', roomCode).order('position'),
        supabase.from('schedule_slots').select('*').eq('room_code', roomCode),
      ])

      if (!room) { clearRoom(); navigate('/'); return }

      setRoom(room)
      setAthletes(aths ?? [])
      setSlots(slots ?? [])
    }

    // Always reload on mount so page refresh gets fresh data
    load()

    // Subscribe to room status changes → navigate all connected phones
    const channel = supabase
      .channel(`sync-${roomCode}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms',
        filter: `code=eq.${roomCode}`,
      }, payload => {
        setRoom(payload.new)
        if (payload.new.status === 'racing') navigate('/race')
        else if (payload.new.status === 'planning') navigate('/planning')
        else if (payload.new.status === 'finished') navigate('/schedule')
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [roomCode]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <RoomSync />
      <Routes>
        <Route path="/"         element={<HomePage />} />
        <Route path="/setup"    element={<SetupPage />} />
        <Route path="/planning" element={<PlanningPage />} />
        <Route path="/race"     element={<LiveRacePage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
