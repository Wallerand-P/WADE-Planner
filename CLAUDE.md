# WADE Planner

Mobile-first PWA for a 4-person relay triathlon team racing T24 (24h relay triathlon).

## Race Format

T24 is a 24-hour relay triathlon with three disciplines run back-to-back:
- **Swimming** — 4 hours total
- **Cycling** — 12 hours total
- **Running** — 8 hours total

Rotations occur after each full loop. Each discipline has its own estimated loop duration per athlete.

## Team

4 athletes. No authentication — access is via a shared room code that all 4 phones use to join the same session.

## App Screens

1. **Setup** — Configure athletes, loop durations per discipline, and room code
2. **Planning** — View and adjust the rotation schedule before the race
3. **Live Race** — Real-time tracking of who is currently racing, who is next, and elapsed/remaining times

## Tech Stack

| Layer       | Choice                          |
|-------------|----------------------------------|
| Frontend    | React + Vite (JavaScript)        |
| Styling     | Tailwind CSS                     |
| State       | Zustand                          |
| Dates/times | Day.js                           |
| Backend     | Supabase (Postgres + Realtime)   |
| Deploy      | Vercel                           |

## Key Constraints

- Mobile-first: designed for phones in landscape/portrait during a race
- Real-time sync: all 4 phones stay in sync via Supabase Realtime subscriptions
- No auth: room code is the only access control
- Offline-resilient: UI should remain usable if connectivity is briefly lost

## Folder Structure

```
src/
  components/   # Shared UI components
  pages/        # Screen-level components (Setup, Planning, LiveRace)
  store/        # Zustand stores
  lib/          # Supabase client and utility helpers
```

## Environment Variables

See `.env.example`. Copy to `.env` and fill in your Supabase project URL and anon key.
