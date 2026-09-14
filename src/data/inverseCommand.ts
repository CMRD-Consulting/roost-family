import type { LogCommand } from './logCommands'

/** Pure: command -> undo command, or null when the command can't be undone by re-applying its inverse. */
export function inverseCommand(cmd: LogCommand): LogCommand | null {
  switch (cmd.kind) {
    case 'sleep.start':
      return { kind: 'entry.delete', householdId: cmd.householdId, table: 'sleep_entries', entryId: cmd.entry.id }
    case 'sleep.end':
      return { kind: 'sleep.end', householdId: cmd.householdId, entryId: cmd.entryId, endAt: cmd.previousEndAt, previousEndAt: cmd.endAt }
    case 'sleep.discard':
      return { kind: 'sleep.restore', householdId: cmd.householdId, entry: cmd.entry, attribution: cmd.attribution }
    case 'sleep.restore':
      return { kind: 'sleep.discard', householdId: cmd.householdId, entry: cmd.entry, attribution: cmd.attribution }

    case 'feeding.add':
      return { kind: 'entry.delete', householdId: cmd.householdId, table: 'feeding_entries', entryId: cmd.entry.id }
    case 'sticker.add':
      return { kind: 'entry.delete', householdId: cmd.householdId, table: 'sticker_entries', entryId: cmd.entry.id }
    case 'diaper.add':
      return { kind: 'entry.delete', householdId: cmd.householdId, table: 'diaper_entries', entryId: cmd.entry.id }
    case 'jot.add':
      return { kind: 'entry.delete', householdId: cmd.householdId, table: 'jots', entryId: cmd.jot.id }

    case 'grocery.add':
      return { kind: 'grocery.delete', householdId: cmd.householdId, item: cmd.item, displayId: cmd.displayId }
    case 'grocery.delete':
      return { kind: 'grocery.add', householdId: cmd.householdId, item: cmd.item, displayId: cmd.displayId }
    case 'grocery.check':
      return { kind: 'grocery.check', householdId: cmd.householdId, itemId: cmd.itemId, checkedAt: cmd.previousCheckedAt, previousCheckedAt: cmd.checkedAt }

    case 'dinner.set':
      return { kind: 'dinner.set', householdId: cmd.householdId, text: cmd.previous, previous: cmd.text }

    case 'routine.step':
      return { ...cmd, done: !cmd.done }

    case 'dose.add':
    case 'entry.delete':
    case 'dose.void':
    case 'dose.acknowledge':
      return null
  }
}
