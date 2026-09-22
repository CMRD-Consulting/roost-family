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

    // Shopping lists archive rather than delete, so undoing an add archives the new list. Its `archivedAt` is the
    // list's own creation instant: the list is hidden either way, and no screen shows when it was archived.
    case 'list.add':
      return { kind: 'list.archive', householdId: cmd.householdId, listId: cmd.list.id, archivedAt: cmd.list.createdAt, previousArchivedAt: cmd.list.archivedAt }
    case 'list.rename':
      return { kind: 'list.rename', householdId: cmd.householdId, listId: cmd.listId, name: cmd.previousName, previousName: cmd.name }
    case 'list.archive':
      return { kind: 'list.restore', householdId: cmd.householdId, listId: cmd.listId, previousArchivedAt: cmd.archivedAt }
    case 'list.restore':
      return { kind: 'list.archive', householdId: cmd.householdId, listId: cmd.listId, archivedAt: cmd.previousArchivedAt, previousArchivedAt: null }

    case 'task.add':
      return { kind: 'task.delete', householdId: cmd.householdId, task: cmd.task, displayId: cmd.displayId }
    case 'task.delete':
      return { kind: 'task.add', householdId: cmd.householdId, task: cmd.task, displayId: cmd.displayId }
    case 'task.check':
      return { kind: 'task.check', householdId: cmd.householdId, taskId: cmd.taskId, doneAt: cmd.previousDoneAt, previousDoneAt: cmd.doneAt }
    case 'task.update':
      return {
        kind: 'task.update',
        householdId: cmd.householdId,
        taskId: cmd.taskId,
        text: cmd.previous.text,
        assignedMembershipId: cmd.previous.assignedMembershipId,
        dueOn: cmd.previous.dueOn,
        previous: { text: cmd.text, assignedMembershipId: cmd.assignedMembershipId, dueOn: cmd.dueOn },
      }

    // Planning a day that had nothing planned is undone by clearing it; otherwise by putting the old plan back.
    case 'meal.set':
      return cmd.previous === null
        ? { kind: 'meal.clear', householdId: cmd.householdId, day: cmd.day, previous: { text: cmd.text, recipeId: cmd.recipeId } }
        : {
            kind: 'meal.set', householdId: cmd.householdId, day: cmd.day, text: cmd.previous.text, recipeId: cmd.previous.recipeId,
            previous: { text: cmd.text, recipeId: cmd.recipeId },
          }
    case 'meal.clear':
      return {
        kind: 'meal.set', householdId: cmd.householdId, day: cmd.day, text: cmd.previous.text, recipeId: cmd.previous.recipeId,
        previous: null,
      }

    case 'dinner.set':
      return { kind: 'dinner.set', householdId: cmd.householdId, text: cmd.previous, previous: cmd.text }

    case 'routine.step':
      return { ...cmd, done: !cmd.done }

    case 'dose.add':
    case 'entry.delete':
    case 'dose.void':
    case 'dose.acknowledge':
    case 'sitter.start':
    case 'sitter.end':
    case 'sitter.summaryShown':
      return null
  }
}
