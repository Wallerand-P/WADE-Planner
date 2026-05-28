import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useRaceStore = create(
  persist(
    (set) => ({
      roomCode: null,
      room: null,
      athletes: [],
      slots: [],

      setRoomCode: (roomCode) => set({ roomCode }),
      setRoom: (room) => set({ room }),
      setAthletes: (athletes) => set({ athletes }),
      setSlots: (slots) => set({ slots }),

      upsertSlot: (slot) => set((state) => {
        const exists = state.slots.some(s => s.id === slot.id)
        return {
          slots: exists
            ? state.slots.map(s => s.id === slot.id ? slot : s)
            : [...state.slots, slot],
        }
      }),

      removeSlot: (id) => set((state) => ({
        slots: state.slots.filter(s => s.id !== id),
      })),

      clearRoom: () => set({ roomCode: null, room: null, athletes: [], slots: [] }),
    }),
    {
      name: 'wade-planner',
      // Only persist the room code — everything else is reloaded from Supabase on mount
      partialize: (state) => ({ roomCode: state.roomCode }),
    }
  )
)
