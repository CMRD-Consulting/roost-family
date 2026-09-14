import type { HouseholdSnapshot } from './snapshot'
import type { LogCommand } from './logCommands'

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  if (list.some((x) => x.id === item.id)) return list
  return [...list, item]
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.some((x) => x.id === id) ? list.filter((x) => x.id !== id) : list
}

function updateById<T extends { id: string }>(list: T[], id: string, fn: (x: T) => T): T[] {
  const index = list.findIndex((x) => x.id === id)
  if (index === -1) return list
  const copy = list.slice()
  copy[index] = fn(list[index]!)
  return copy
}

/** Pure, optimistic apply of a command to a snapshot. Never mutates `snapshot`. Idempotent per id. */
export function applyCommand(snapshot: HouseholdSnapshot, cmd: LogCommand, now: Date): HouseholdSnapshot {
  switch (cmd.kind) {
    case 'sleep.start':
    case 'sleep.restore':
      return { ...snapshot, sleeps: upsertById(snapshot.sleeps, cmd.entry) }
    case 'sleep.end':
      return { ...snapshot, sleeps: updateById(snapshot.sleeps, cmd.entryId, (e) => ({ ...e, endAt: cmd.endAt })) }
    case 'sleep.discard':
      return { ...snapshot, sleeps: removeById(snapshot.sleeps, cmd.entry.id) }

    case 'feeding.add':
      return { ...snapshot, feedings: upsertById(snapshot.feedings, cmd.entry) }
    case 'sticker.add':
      return { ...snapshot, stickers: upsertById(snapshot.stickers, cmd.entry) }
    case 'diaper.add':
      return { ...snapshot, diapers: upsertById(snapshot.diapers, cmd.entry) }

    case 'dose.add': {
      if (snapshot.doses.some((d) => d.id === cmd.entry.id)) return snapshot
      const entry = {
        ...cmd.entry,
        createdAt: cmd.entry.createdAt || now.toISOString(),
        loggedByName: cmd.entry.loggedByName ?? cmd.attribution.loggedByName,
      }
      return { ...snapshot, doses: [...snapshot.doses, entry] }
    }
    case 'dose.void':
      return { ...snapshot, doses: updateById(snapshot.doses, cmd.doseId, (d) => ({ ...d, voidedAt: now.toISOString() })) }
    case 'dose.acknowledge':
      return { ...snapshot, doses: updateById(snapshot.doses, cmd.doseId, (d) => ({ ...d, conflictAcknowledgedAt: now.toISOString() })) }

    case 'jot.add':
      return { ...snapshot, jots: upsertById(snapshot.jots, cmd.jot) }

    case 'grocery.add':
      return { ...snapshot, groceries: upsertById(snapshot.groceries, cmd.item) }
    case 'grocery.check':
      return { ...snapshot, groceries: updateById(snapshot.groceries, cmd.itemId, (g) => ({ ...g, checkedAt: cmd.checkedAt })) }
    case 'grocery.delete':
      return { ...snapshot, groceries: removeById(snapshot.groceries, cmd.item.id) }

    case 'entry.delete':
      switch (cmd.table) {
        case 'sleep_entries':
          return { ...snapshot, sleeps: removeById(snapshot.sleeps, cmd.entryId) }
        case 'feeding_entries':
          return { ...snapshot, feedings: removeById(snapshot.feedings, cmd.entryId) }
        case 'sticker_entries':
          return { ...snapshot, stickers: removeById(snapshot.stickers, cmd.entryId) }
        case 'diaper_entries':
          return { ...snapshot, diapers: removeById(snapshot.diapers, cmd.entryId) }
        case 'jots':
          return { ...snapshot, jots: removeById(snapshot.jots, cmd.entryId) }
      }
      break

    case 'dinner.set':
      return { ...snapshot, household: { ...snapshot.household, dinnerTonight: cmd.text } }

    case 'routine.complete': {
      const index = snapshot.routineProgress.findIndex(
        (p) => p.childId === cmd.childId && p.routineId === cmd.routineId && p.day === cmd.day,
      )
      if (index === -1) {
        const row = { childId: cmd.childId, routineId: cmd.routineId, day: cmd.day, completed: cmd.completed }
        return { ...snapshot, routineProgress: [...snapshot.routineProgress, row] }
      }
      const copy = snapshot.routineProgress.slice()
      copy[index] = { ...copy[index]!, completed: cmd.completed }
      return { ...snapshot, routineProgress: copy }
    }
  }
  return snapshot
}
