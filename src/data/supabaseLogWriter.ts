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

function jotRow(jot: Jot, householdId: string, displayId: string | null) {
  return { id: jot.id, household_id: householdId, text: jot.text, display_id: displayId }
}

function groceryRow(item: GroceryItem, householdId: string, displayId: string | null) {
  return { id: item.id, household_id: householdId, text: item.text, display_id: displayId }
}

type OpResult = { error: { message: string; code?: string } | null; data?: unknown }

/** Runs a Postgrest/RPC call and maps failures to LogWriteError. Returns the response data. */
async function run(op: () => PromiseLike<OpResult>): Promise<unknown> {
  let result: OpResult
  try {
    result = await op()
  } catch (e) {
    throw new LogWriteError(e instanceof Error ? e.message : String(e), true, null)
  }
  if (result.error) {
    const code = result.error.code || null
    throw new LogWriteError(result.error.message, !code, code)
  }
  return result.data
}

function rowCount(data: unknown): number {
  return Array.isArray(data) ? data.length : 0
}

/** An update (with `.select('id')`) that matched no row: the row may not have synced yet, so retry later. */
async function runUpdate(op: () => PromiseLike<OpResult>): Promise<void> {
  if (rowCount(await run(op)) === 0) throw new LogWriteError('Not found yet', true, 'NOT_FOUND')
}

/** Inserts, RPCs and deletes. (A delete matching no row means it's already gone, which is success.) */
async function runWrite(op: () => PromiseLike<OpResult>): Promise<void> {
  await run(op)
}

export function createSupabaseLogWriter(client: RoostClient): LogWriter {
  async function execute(cmd: LogCommand): Promise<void> {
    switch (cmd.kind) {
      case 'sleep.start':
      case 'sleep.restore':
        return runWrite(() => client.from('sleep_entries').upsert(sleepRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sleep.end':
        return runUpdate(() => client.from('sleep_entries').update({ end_at: cmd.endAt }).eq('id', cmd.entryId).select('id'))
      case 'sleep.discard':
        return runWrite(() => client.from('sleep_entries').delete().eq('id', cmd.entry.id).select('id'))

      case 'feeding.add':
        return runWrite(() => client.from('feeding_entries').upsert(feedingRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sticker.add':
        return runWrite(() => client.from('sticker_entries').upsert(stickerRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'diaper.add':
        return runWrite(() => client.from('diaper_entries').upsert(diaperRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'dose.add':
        return runWrite(() => client.from('dose_entries').upsert(doseRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))

      case 'jot.add':
        return runWrite(() => client.from('jots').upsert(jotRow(cmd.jot, cmd.householdId, cmd.displayId), UPSERT_OPTS))

      case 'grocery.add':
        return runWrite(() => client.from('grocery_items').upsert(groceryRow(cmd.item, cmd.householdId, cmd.displayId), UPSERT_OPTS))
      case 'grocery.check':
        return runUpdate(() => client.from('grocery_items').update({ checked_at: cmd.checkedAt }).eq('id', cmd.itemId).select('id'))
      case 'grocery.delete':
        return runWrite(() => client.from('grocery_items').delete().eq('id', cmd.item.id).select('id'))

      case 'entry.delete':
        return runWrite(() => client.from(cmd.table).delete().eq('id', cmd.entryId).select('id'))

      case 'dose.void':
        return runWrite(() =>
          client.rpc('void_dose', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin, p_reason: cmd.reason }),
        )
      case 'dose.acknowledge':
        return runWrite(() => client.rpc('acknowledge_dose_conflict', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin }))
      case 'dinner.set':
        return runWrite(() => client.rpc('set_dinner_tonight', { p_household_id: cmd.householdId, p_text: cmd.text ?? '' }))
    }
  }

  async function verifyPin(membershipId: string, pin: string): Promise<boolean> {
    const { data, error } = await client.rpc('verify_pin', { p_membership_id: membershipId, p_pin: pin })
    if (error) throw new LogWriteError(error.message, !error.code, error.code || null)
    return data === true
  }

  return { execute, verifyPin }
}
