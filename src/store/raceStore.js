import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useRaceStore = create(
  persist(
    (set) => ({
      roomCode: null,
      room: null,
      event: null,
      athletes: [],
      slots: [],
      recentRooms: [], // [{ code, name }] of rooms this device has entered

      setRoomCode: (roomCode) => set({ roomCode }),
      setRoom: (room) => set({ room }),
      setEvent: (event) => set({ event }),
      setAthletes: (athletes) => set({ athletes }),
      setSlots: (slots) => set({ slots }),

      // Record a room this device has entered (most recent first, deduped by code)
      addRecentRoom: ({ code, name }) => set((state) => ({
        recentRooms: [
          { code, name: name ?? '' },
          ...state.recentRooms.filter(r => r.code !== code),
        ],
      })),

      removeRecentRoom: (code) => set((state) => ({
        recentRooms: state.recentRooms.filter(r => r.code !== code),
      })),

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

      clearRoom: () => set({ roomCode: null, room: null, event: null, athletes: [], slots: [] }),
    }),
    {
      name: 'wade-planner',
      // Persist the current room code and the recent-rooms list; everything else
      // is reloaded from Supabase on mount.
      partialize: (state) => ({ roomCode: state.roomCode, recentRooms: state.recentRooms }),
    }
  )
)
