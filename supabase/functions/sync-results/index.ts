// Edge Function: poll klikego for every racing, results-confirmed room and
// reconcile its schedule. Reuses the app's pure parser + reconciler + disciplines
// (bundled at deploy time from src/lib/), so server and client run identical logic.
//
// Triggered by pg_cron (~60s). See docs/live-results-sync.md.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseTeamDetail } from './klikego.js'
import { reconcile } from './reconcile.js'
import { eventDisciplines } from './disciplines.js'

const KLIKEGO = 'https://www.klikego.com/specific/t24/detail-resultats.jsp'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// deno-lint-ignore no-explicit-any
async function syncRoom(supabase: any, room: any) {
  const [{ data: athletes }, { data: slots }, eventRes] = await Promise.all([
    supabase.from('athletes').select('*').eq('room_code', room.code),
    supabase.from('schedule_slots').select('*').eq('room_code', room.code),
    room.event_id
      ? supabase.from('events').select('*').eq('id', room.event_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const event = eventRes?.data ?? null

  const url = `${KLIKEGO}?reference=${encodeURIComponent(room.results_reference)}` +
    `&dossard=${encodeURIComponent(room.results_dossard)}` +
    `&category=${encodeURIComponent(room.results_category ?? '')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`klikego responded ${res.status}`)
  const detail = parseTeamDetail(await res.text())

  const athleteBySuffix: Record<number, string> = {}
  for (const a of athletes ?? []) if (a.bib_suffix != null) athleteBySuffix[a.bib_suffix] = a.id

  const result = reconcile({
    laps: detail.laps,
    klikegoDisciplines: detail.disciplines,
    appDisciplines: eventDisciplines(event),
    slots: slots ?? [],
    athleteBySuffix,
    raceStartMs: new Date(room.race_start_time).getTime(),
    raceFinished: room.status === 'finished',
  })
  if (!result.ok) throw new Error(`reconcile failed: ${result.reason}`)

  if (result.deletes.length) {
    const { error } = await supabase.from('schedule_slots').delete().in('id', result.deletes)
    if (error) throw error
  }
  for (const u of result.upserts) {
    if (u.athlete_id == null) continue
    const row = {
      discipline: u.discipline,
      slot_order: u.slot_order,
      athlete_id: u.athlete_id,
      actual_start_time: new Date(u.actualStartMs).toISOString(),
      actual_end_time: new Date(u.actualEndMs).toISOString(),
      confirmed: true,
    }
    if (u.id) {
      const { error } = await supabase.from('schedule_slots')
        .update(row).eq('id', u.id).eq('manual_override', false)
      if (error) throw error
    } else {
      const { error } = await supabase.from('schedule_slots')
        .insert({ ...row, room_code: room.code, planned_duration_minutes: u.planned_duration_minutes ?? 1 })
      if (error) throw error
    }
  }

  const syncedAt = new Date().toISOString()
  await supabase.from('rooms').update({ results_synced_at: syncedAt }).eq('code', room.code)
  return { laps: detail.laps.length, updated: result.upserts.length, removed: result.deletes.length, skipped: result.skipped.length }
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rooms, error } = await supabase.from('rooms').select('*')
    .eq('status', 'racing').eq('results_confirmed', true)
  if (error) return json({ ok: false, error: error.message }, 500)

  const synced: unknown[] = []
  for (const room of rooms ?? []) {
    try {
      synced.push({ room: room.code, ...(await syncRoom(supabase, room)) })
    } catch (e) {
      synced.push({ room: room.code, error: String((e as Error)?.message ?? e) })
    }
  }
  return json({ ok: true, count: synced.length, synced })
})
