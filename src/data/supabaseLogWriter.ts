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

/** Runs a Postgrest/RPC call and maps failures to LogWriteError. */
async function run(op: () => PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<void> {
  let result: { error: { message: string; code?: string } | null }
  try {
    result = await op()
  } catch (e) {
    throw new LogWriteError(e instanceof Error ? e.message : String(e), true, null)
  }
  if (result.error) {
    const code = result.error.code || null
    throw new LogWriteError(result.error.message, !code, code)
  }
}

export function createSupabaseLogWriter(client: RoostClient): LogWriter {
  async function execute(cmd: LogCommand): Promise<void> {
    switch (cmd.kind) {
      case 'sleep.start':
      case 'sleep.restore':
        return run(() => client.from('sleep_entries').upsert(sleepRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sleep.end':
        return run(() => client.from('sleep_entries').update({ end_at: cmd.endAt }).eq('id', cmd.entryId))
      case 'sleep.discard':
        return run(() => client.from('sleep_entries').delete().eq('id', cmd.entry.id))

      case 'feeding.add':
        return run(() => client.from('feeding_entries').upsert(feedingRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'sticker.add':
        return run(() => client.from('sticker_entries').upsert(stickerRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'diaper.add':
        return run(() => client.from('diaper_entries').upsert(diaperRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))
      case 'dose.add':
        return run(() => client.from('dose_entries').upsert(doseRow(cmd.entry, cmd.householdId, cmd.attribution), UPSERT_OPTS))

      case 'jot.add':
        return run(() => client.from('jots').upsert(jotRow(cmd.jot, cmd.householdId, cmd.displayId), UPSERT_OPTS))

      case 'grocery.add':
        return run(() => client.from('grocery_items').upsert(groceryRow(cmd.item, cmd.householdId, cmd.displayId), UPSERT_OPTS))
      case 'grocery.check':
        return run(() => client.from('grocery_items').update({ checked_at: cmd.checkedAt }).eq('id', cmd.itemId))
      case 'grocery.delete':
        return run(() => client.from('grocery_items').delete().eq('id', cmd.item.id))

      case 'entry.delete':
        return run(() => client.from(cmd.table).delete().eq('id', cmd.entryId))

      case 'dose.void':
        return run(() =>
          client.rpc('void_dose', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin, p_reason: cmd.reason }),
        )
      case 'dose.acknowledge':
        return run(() => client.rpc('acknowledge_dose_conflict', { p_dose_id: cmd.doseId, p_membership_id: cmd.membershipId, p_pin: cmd.pin }))
      case 'dinner.set':
        return run(() => client.rpc('set_dinner_tonight', { p_household_id: cmd.householdId, p_text: cmd.text ?? '' }))
    }
  }

  async function verifyPin(membershipId: string, pin: string): Promise<boolean> {
    const { data, error } = await client.rpc('verify_pin', { p_membership_id: membershipId, p_pin: pin })
    if (error) throw new LogWriteError(error.message, !error.code, error.code || null)
    return data === true
  }

  return { execute, verifyPin }
}
