// Orchestrates one live-results sync: fetch the team page, reconcile against the
// current plan, and apply the writes to Supabase. Reused by the client "Sync now"
// button (here) and later by the Edge Function (same pure parser + reconciler).

import dayjs from 'dayjs'
import { supabase } from './supabase'
import { eventDisciplines } from './raceUtils'
import { fetchTeamDetail } from './klikegoClient'
import { reconcile } from './reconcile'

export async function syncLiveResults({ room, event, athletes, slots }) {
  if (!room?.results_reference || !room?.results_dossard) {
    throw new Error('No live-results source configured')
  }

  const detail = await fetchTeamDetail({
    reference: room.results_reference,
    dossard: room.results_dossard,
    category: room.results_category,
  })

  const athleteBySuffix = {}
  for (const a of athletes) if (a.bib_suffix != null) athleteBySuffix[a.bib_suffix] = a.id

  const result = reconcile({
    laps: detail.laps,
    klikegoDisciplines: detail.disciplines,
    appDisciplines: eventDisciplines(event),
    slots,
    athleteBySuffix,
    raceStartMs: dayjs(room.race_start_time).valueOf(),
    raceFinished: room.status === 'finished',
  })
  if (!result.ok) throw new Error(`Cannot sync: ${result.reason}`)

  // Closure deletes first, then the lap upserts.
  if (result.deletes.length) {
    const { error } = await supabase.from('schedule_slots').delete().in('id', result.deletes)
    if (error) throw error
  }

  for (const u of result.upserts) {
    if (u.athlete_id == null) continue // unmapped racer — can't write (shouldn't happen in Authority)
    const row = {
      discipline: u.discipline,
      slot_order: u.slot_order,
      athlete_id: u.athlete_id,
      actual_start_time: new Date(u.actualStartMs).toISOString(),
      actual_end_time: new Date(u.actualEndMs).toISOString(),
      confirmed: true,
    }
    if (u.id) {
      // Defence-in-depth: never overwrite a locked slot (reconcile already skips them).
      const { error } = await supabase.from('schedule_slots')
        .update(row).eq('id', u.id).eq('manual_override', false)
      if (error) throw error
    } else {
      const { error } = await supabase.from('schedule_slots').insert({
        ...row, room_code: room.code, planned_duration_minutes: u.planned_duration_minutes ?? 1,
      })
      if (error) throw error
    }
  }

  const syncedAt = new Date().toISOString()
  await supabase.from('rooms').update({ results_synced_at: syncedAt }).eq('code', room.code)

  return {
    syncedAt,
    lapCount: detail.laps.length,
    updated: result.upserts.length,
    removed: result.deletes.length,
    skipped: result.skipped.length,
  }
}
