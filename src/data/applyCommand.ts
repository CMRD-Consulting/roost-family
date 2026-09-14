import type { HouseholdSnapshot } from './snapshot'
import type { Attribution, LogCommand } from './logCommands'

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

/** The entry as the server will store it: its sitter session comes from the command's attribution. */
function attributed<T extends { sitterSessionId: string | null }>(entry: T, attribution: Attribution): T {
  return entry.sitterSessionId === attribution.sitterSessionId ? entry : { ...entry, sitterSessionId: attribution.sitterSessionId }
}

/** Pure, optimistic apply of a command to a snapshot. Never mutates `snapshot`. Idempotent per id. */
export function applyCommand(snapshot: HouseholdSnapshot, cmd: LogCommand, now: Date): HouseholdSnapshot {
  switch (cmd.kind) {
    case 'sleep.start':
    case 'sleep.restore':
      return { ...snapshot, sleeps: upsertById(snapshot.sleeps, attributed(cmd.entry, cmd.attribution)) }
    case 'sleep.end':
      return { ...snapshot, sleeps: updateById(snapshot.sleeps, cmd.entryId, (e) => ({ ...e, endAt: cmd.endAt })) }
    case 'sleep.discard':
      return { ...snapshot, sleeps: removeById(snapshot.sleeps, cmd.entry.id) }

    case 'feeding.add':
      return { ...snapshot, feedings: upsertById(snapshot.feedings, attributed(cmd.entry, cmd.attribution)) }
    case 'sticker.add':
      return { ...snapshot, stickers: upsertById(snapshot.stickers, attributed(cmd.entry, cmd.attribution)) }
    case 'diaper.add':
      return { ...snapshot, diapers: upsertById(snapshot.diapers, attributed(cmd.entry, cmd.attribution)) }

    case 'dose.add': {
      if (snapshot.doses.some((d) => d.id === cmd.entry.id)) return snapshot
      const entry = {
        ...cmd.entry,
        createdAt: cmd.entry.createdAt || now.toISOString(),
        loggedByName: cmd.entry.loggedByName ?? cmd.attribution.loggedByName,
        sitterSessionId: cmd.attribution.sitterSessionId,
      }
      return { ...snapshot, doses: [...snapshot.doses, entry] }
    }
    case 'dose.void':
      return { ...snapshot, doses: updateById(snapshot.doses, cmd.doseId, (d) => ({ ...d, voidedAt: now.toISOString(), voidReason: cmd.reason })) }
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

    case 'sitter.start':
      // The server allows one open session per household, so an active one (e.g. the server's copy) wins.
      if (snapshot.activeSitterSession !== null) return snapshot
      return {
        ...snapshot,
        activeSitterSession: {
          id: cmd.sessionId, sitterName: cmd.sitterName, startedAt: cmd.startedAt, endedAt: null, summaryShownAt: null,
        },
      }
    case 'sitter.end': {
      const active = snapshot.activeSitterSession
      if (active === null || active.id !== cmd.sessionId) return snapshot
      const ended = { ...active, endedAt: cmd.endedAt }
      // A device-cached snapshot from before unseen sessions were loaded has none.
      const unseen = (snapshot.unseenSitterSessions ?? []).filter((x) => x.id !== ended.id)
      return { ...snapshot, activeSitterSession: null, recentSitterSession: ended, unseenSitterSessions: [...unseen, ended] }
    }
    case 'sitter.summaryShown': {
      const recent = snapshot.recentSitterSession
      const recentMatches = recent !== null && recent.id === cmd.sessionId && recent.summaryShownAt === null
      const unseen = snapshot.unseenSitterSessions ?? []
      const inUnseen = unseen.some((x) => x.id === cmd.sessionId)
      if (!recentMatches && !inUnseen) return snapshot
      return {
        ...snapshot,
        ...(recentMatches ? { recentSitterSession: { ...recent, summaryShownAt: now.toISOString() } } : {}),
        ...(inUnseen ? { unseenSitterSessions: unseen.filter((x) => x.id !== cmd.sessionId) } : {}),
      }
    }

    case 'routine.step': {
      const matches = (p: { childId: string; routineId: string; day: string }) =>
        p.childId === cmd.childId && p.routineId === cmd.routineId && p.day === cmd.day
      const index = snapshot.routineProgress.findIndex(matches)
      const before = index === -1 ? [] : snapshot.routineProgress[index]!.completed
      const without = before.filter((i) => i !== cmd.stepIndex)
      const completed = cmd.done ? [...without, cmd.stepIndex].sort((a, b) => a - b) : without
      if (index === -1) {
        const row = { childId: cmd.childId, routineId: cmd.routineId, day: cmd.day, completed }
        return { ...snapshot, routineProgress: [...snapshot.routineProgress, row] }
      }
      const copy = snapshot.routineProgress.slice()
      copy[index] = { ...copy[index]!, completed }
      return { ...snapshot, routineProgress: copy }
    }
  }
  return snapshot
}
