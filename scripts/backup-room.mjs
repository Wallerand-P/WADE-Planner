// Generate an idempotent SQL backup of a single room (room + athletes + slots)
// straight from the database, so backups never drift from hand-transcription.
//
// Usage:  node scripts/backup-room.mjs <ROOM_CODE>
// Output: backups/<name>_<code>_<YYYY-MM-DD>.sql
//
// Restore: run the file in the Supabase SQL editor. Upserts are keyed on the
// rows' UUIDs, so re-running restores the exact state without duplicates.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// Minimal .env loader (only the two keys we need)
function env(key) {
  if (process.env[key]) return process.env[key]
  const line = readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/).find(l => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : undefined
}

const code = process.argv[2]
if (!code) { console.error('Usage: node scripts/backup-room.mjs <ROOM_CODE>'); process.exit(1) }

const supabase = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'))

// SQL literal: null -> NULL, number -> as-is, boolean -> true/false, else quoted+escaped
const q = v =>
  v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`

const upsert = (table, cols, row, conflict, updateCols) =>
  `insert into ${table} (${cols.join(',')}) values (${cols.map(c => q(row[c])).join(',')}) ` +
  `on conflict (${conflict}) do update set ${updateCols.map(c => `${c}=excluded.${c}`).join(',')};`

const [{ data: room }, { data: athletes }, { data: slots }] = await Promise.all([
  supabase.from('rooms').select('*').eq('code', code).single(),
  supabase.from('athletes').select('*').eq('room_code', code).order('position'),
  supabase.from('schedule_slots').select('*').eq('room_code', code).order('discipline').order('slot_order'),
])
if (!room) { console.error(`Room ${code} not found`); process.exit(1) }

const roomCols = ['code', 'name', 'event_id', 'status', 'race_start_time', 'created_at']
const athCols = ['id', 'room_code', 'name', 'color', 'position', 'swim_pace', 'bike_pace', 'run_pace', 'bike2_pace', 'bib_suffix']
const slotCols = ['id', 'room_code', 'discipline', 'slot_order', 'athlete_id', 'planned_duration_minutes',
  'actual_start_time', 'actual_end_time', 'confirmed', 'manual_override', 'created_at']

const today = new Date().toISOString().slice(0, 10)
const counts = { swim: 0, bike: 0, bike2: 0, run: 0 }
for (const s of slots) counts[s.discipline] = (counts[s.discipline] || 0) + 1

const sql = [
  `-- Backup of room '${room.name ?? ''}' (code ${code}) — captured ${today}`,
  `-- Event: ${room.event_id ?? '(none)'} · ${athletes.length} athletes · ${slots.length} slots ` +
    `(${counts.swim} swim / ${counts.bike + counts.bike2} bike / ${counts.run} run)`,
  `--`,
  `-- Restore: run this file in the Supabase SQL editor. Idempotent (upserts keyed`,
  `-- on UUIDs). For a clean restore first: delete from schedule_slots where room_code='${code}';`,
  ``,
  `begin;`,
  ``,
  upsert('rooms', roomCols, room, 'code', ['name', 'event_id', 'status', 'race_start_time']),
  ``,
  ...athletes.map(a => upsert('athletes', athCols, a, 'id',
    ['name', 'color', 'position', 'swim_pace', 'bike_pace', 'run_pace', 'bike2_pace', 'bib_suffix'])),
  ``,
  ...slots.map(s => upsert('schedule_slots', slotCols, s, 'id',
    ['discipline', 'slot_order', 'athlete_id', 'planned_duration_minutes', 'confirmed', 'manual_override'])),
  ``,
  `commit;`,
  ``,
].join('\n')

const safeName = (room.name ?? code).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
const outDir = resolve(root, 'backups')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, `${safeName}_${code}_${today}.sql`)
writeFileSync(outPath, sql)
console.log(`Wrote ${outPath}`)
console.log(`Room: ${room.name} · ${athletes.length} athletes · ${slots.length} slots`)
