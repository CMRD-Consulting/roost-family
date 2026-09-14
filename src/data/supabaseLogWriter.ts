import type { DiaperEntry, DoseEntry, FeedingEntry, SleepEntry, StickerEntry } from '@/domain/types'
import type { Attribution, LogCommand } from './logCommands'
import { LogWriteError, type LogWriter } from './logWriter'
import type { RoostClient } from './supabase'
import type { GroceryItem, Jot } from './snapshot'

const UPSERT_OPTS = { onConflict: 'id', ignoreDuplicates: true } as const

function attributionColumns(attribution: Attribution) {
  return {
    display_id: attribution.displayId,
    logged_by_membership_id: attribution.loggedByMembershipId,
    sitter_session_id: attribution.sitterSessionId,
  }
}

function sleepRow(entry: SleepEntry, householdId: string, attribution: Attribution) {
  return {
    id: entry.id,
    household_id: householdId,
    child_id: entry.childId,
    start_at: entry.startAt,
    end_at: entry.endAt,
    type: entry.type,
    ...attributionColumns(attribution),
  }
}

function feedingRow(entry: FeedingEntry, householdId: string, attribution: Attribution) {
  return {
    id: entry.id,
    household_id: householdId,
    child_id: entry.childId,
    at: entry.at,
    type: entry.type,
    amount: entry.amount,
    note: entry.note,
    ...attributionColumns(attribution),
  }
}

function stickerRow(entry: StickerEntry, householdId: string, attribution: Attribution) {
  return {
    id: entry.id,
    household_id: householdId,
    child_id: entry.childId,
    category_id: entry.categoryId,
    at: entry.at,
    ...attributionColumns(attribution),
  }
}

function diaperRow(entry: DiaperEntry, householdId: string, attribution: Attribution) {
  return {
    id: entry.id,
    household_id: householdId,
    child_id: entry.childId,
    at: entry.at,
    kind: entry.kind,
    ...attributionColumns(attribution),
  }
}

function doseRow(entry: DoseEntry, householdId: string, attribution: Attribution) {
  return {
    id: entry.id,
    household_id: householdId,
    child_id: entry.childId,
    medicine_id: entry.medicineId,
    at: entry.at,
    note: entry.note,
    logged_offline: entry.loggedOffline,
    warnings_confirmed: entry.warningsConfirmed,
    ...attributionColumns(attribution),
  }
}

// Jots and groceries carry their own timestamps, so an undo that re-adds one keeps its place and checked state.
function jotRow(jot: Jot, householdId: string, displayId: string | null) {
  return { id: jot.id, household_id: householdId, text: jot.text, display_id: displayId, created_at: jot.createdAt, done_at: jot.doneAt }
}

function groceryRow(item: GroceryItem, householdId: string, displayId: string | null) {
  return {
    id: item.id, household_id: householdId, text: item.text, display_id: displayId,
    created_at: item.createdAt, checked_at: item.checkedAt,
  }
}

type OpResult = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

/**
 * Whether a failed write is worth retrying later (queued) rather than dropped.
 * Retryable: the request never got an answer (no status, no code), 401/408/429/5xx, PostgREST JWT errors
 * (PGRST3xx), and 42501 sent without a user session (it will pass once the session is back).
 * Permanent: other 4xx answers (constraint, input, raised exceptions, PostgREST 1xx/2xx) and 42501 with a session.
 */
export function isRetryableWriteError(e: { status: number | null; code: string | null; hasSession: boolean }): boolean {
  const code = e.code || null
  const status = e.status || null
  if (status === null && code === null) return true
  if (status === 401 || status === 408 || status === 429 || (status !== null && status >= 500)) return true
  if (code?.startsWith('PGRST3')) return true
  if (code === '42501') return !e.hasSession
  return false
}

async function hasSession(client: RoostClient): Promise<boolean> {
  try {
    const { data } = await client.auth.getSession()
    return data.session !== null
  } catch {
    return false
  }
}

/** Runs a Postgrest/RPC call and maps failures to LogWriteError. Returns the response data. */
async function run(client: RoostClient, op: () => PromiseLike<OpResult>): Promise<unknown> {
  const sessionBefore = await hasSession(client)
  let result: OpResult
  try {
    result = await op()
  } catch (e) {
    throw new LogWriteError(e instanceof Error ? e.message : String(e), true, null)
  }
  if (result.error) {
    const code = result.error.code || null
    const status = result.status || null
    throw new LogWriteError(result.error.message, isRetryableWriteError({ status, code, hasSession: sessionBefore }), code, status)
  }
  return result.data
}

function rowCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 0
}

/** An update (with `.select('id')`) that matched no row: the row may not have synced yet, so retry later. */
async function runUpdate(client: RoostClient, op: () => PromiseLike<OpResult>): Promise<void> {
  if (rowCount(await run(client, op)) === 0) throw new LogWriteError('Not found yet', true, 'NOT_FOUND')
}

/** Inserts, RPCs and deletes. (A delete matching no row means it's already gone, which is success.) */
async function runWrite(client: RoostClient, op: () => PromiseLike<OpResult>): Promise<void> {
  await run(client, op)
}

export function createSupabaseLogWriter(client: RoostClient): LogWriter {
  async function execute(cmd: LogCommand): Promise<void> {
    switch (cmd.kind) {
      case 'sleep.start':
      case 'sleep.restore':
        return runWrite(client, () => client.from('sleep_entries').upsert(sleepRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sleep.end':
        return runUpdate(client, () => client.from('sleep_entries').update({ end_at: cmd.endAt }).eq('id', cmd.entryId).select('id'))
      case 'sleep.discard':
        return runWrite(client, () => client.from('sleep_entries').delete().eq('id', cmd.entry.id).select('id'))

      case 'feeding.add':
        return runWrite(client, () => client.from('feeding_entries').upsert(feedingRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sticker.add':
        return runWrite(client, () => client.from('sticker_entries').upsert(stickerRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'diaper.add':
        return runWrite(client, () => client.from('diaper_entries').upsert(diaperRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'dose.add':
        return runWrite(client, () => client.from('dose_entries').upsert(doseRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))

      case 'jot.add':
        return runWrite(client, () => client.from('jots').upsert(jotRow(cmd.jot, cmd.householdId, cmd.displayId), UPSERT_OPTS))

      case 'grocery.add':
        return runWrite(client, () => client.from('grocery_items').upsert(groceryRow(cmd.item, cmd.householdId, cmd.displayId), UPSERT_OPTS))
      case 'grocery.check':
        return runUpdate(client, () => client.from('grocery_items').update({ checked_at: cmd.checkedAt }).eq('id', cmd.itemId).select('id'))
      case 'grocery.delete':
        return runWrite(client, () => client.from('grocery_items').delete().eq('id', cmd.item.id).select('id'))

      case 'entry.delete':
        return runWrite(client, () => client.from(cmd.table).delete().eq('id', cmd.entryId).select('id'))

      case 'dose.void':
        return runWrite(client, () =>
          client.rpc('void_dose', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin, p_reason: cmd.reason }),
        )
      case 'dose.acknowledge':
        return runWrite(client, () => client.rpc('acknowledge_dose_conflict', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin }))
      case 'dinner.set':
        return runWrite(client, () => client.rpc('set_dinner_tonight', { p_household_id: cmd.householdId, p_text: cmd.text ?? '' }))
      // Sitter Mode: PIN-checked on the server. For start, the server creates the session id (the client's
      // sessionId is optimistic only), and a sitter name or display left out defaults to null.
      case 'sitter.start':
        return runWrite(client, () =>
          client.rpc('start_sitter_session', {
            p_household_id: cmd.householdId, p_membership_id: cmd.membershipId, p_pin: cmd.pin,
            p_sitter_name: cmd.sitterName ?? undefined, p_display_id: cmd.displayId ?? undefined,
          }),
        )
      case 'sitter.end':
        return runWrite(client, () =>
          client.rpc('end_sitter_session', { p_session_id: cmd.sessionId, p_membership_id: cmd.membershipId, p_pin: cmd.pin }),
        )
      case 'sitter.summaryShown':
        return runWrite(client, () => client.rpc('mark_sitter_summary_shown', { p_session_id: cmd.sessionId }))
      // The server adds or removes just this step inside one locked upsert, so concurrent steps are all kept.
      case 'routine.step':
        return runWrite(client, () =>
          client.rpc('set_routine_step', {
            p_child_id: cmd.childId, p_routine_id: cmd.routineId, p_day: cmd.day, p_step_index: cmd.stepIndex, p_done: cmd.done,
          }),
        )
    }
  }

  async function verifyPin(membershipId: string, pin: string): Promise<boolean> {
    const data = await run(client, () => client.rpc('verify_pin', { p_membership_id: membershipId, p_pin: pin }))
    return data === true
  }

  return { execute, verifyPin, ready: () => hasSession(client) }
}
