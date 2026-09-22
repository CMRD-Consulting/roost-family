import type { HouseholdSnapshot, MealPlanEntry } from './snapshot'
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

/** The household's default list: its oldest un-archived one, mirroring the `grocery_items` insert trigger
 *  (spec §3.1). Empty when no list is known, which only happens on a snapshot cached before the Kitchen screen. */
function defaultListId(snapshot: HouseholdSnapshot): string {
  return (snapshot.shoppingLists ?? []).find((l) => l.archivedAt === null)?.id ?? ''
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

    case 'grocery.add': {
      // An item queued without a list (an older build, or the Grocery sheet) lands on the default list.
      const item = cmd.item.listId ? cmd.item : { ...cmd.item, listId: defaultListId(snapshot) }
      return { ...snapshot, groceries: upsertById(snapshot.groceries, item) }
    }
    case 'grocery.check':
      return { ...snapshot, groceries: updateById(snapshot.groceries, cmd.itemId, (g) => ({ ...g, checkedAt: cmd.checkedAt })) }
    case 'grocery.delete':
      return { ...snapshot, groceries: removeById(snapshot.groceries, cmd.item.id) }

    // Shopping lists, tasks and the meal plan are optional on the snapshot (a device-cached one from before the
    // Kitchen screen has none), so each case starts from `?? []`.
    case 'list.add':
      return { ...snapshot, shoppingLists: upsertById(snapshot.shoppingLists ?? [], cmd.list) }
    case 'list.rename':
      return { ...snapshot, shoppingLists: updateById(snapshot.shoppingLists ?? [], cmd.listId, (l) => ({ ...l, name: cmd.name })) }
    case 'list.archive':
      return { ...snapshot, shoppingLists: updateById(snapshot.shoppingLists ?? [], cmd.listId, (l) => ({ ...l, archivedAt: cmd.archivedAt })) }
    case 'list.restore':
      return { ...snapshot, shoppingLists: updateById(snapshot.shoppingLists ?? [], cmd.listId, (l) => ({ ...l, archivedAt: null })) }

    case 'task.add':
      return { ...snapshot, tasks: upsertById(snapshot.tasks ?? [], cmd.task) }
    case 'task.check':
      return { ...snapshot, tasks: updateById(snapshot.tasks ?? [], cmd.taskId, (t) => ({ ...t, doneAt: cmd.doneAt })) }
    case 'task.update':
      return {
        ...snapshot,
        tasks: updateById(snapshot.tasks ?? [], cmd.taskId, (t) => ({
          ...t, text: cmd.text, assignedMembershipId: cmd.assignedMembershipId, dueOn: cmd.dueOn,
        })),
      }
    case 'task.delete':
      return { ...snapshot, tasks: removeById(snapshot.tasks ?? [], cmd.task.id) }

    case 'meal.set': {
      // One entry per day, so the day is the key. The server generates the row's id; until the next load this
      // optimistic row stands in for it, keyed by the day so a replay updates it instead of adding a second one.
      const plan = snapshot.mealPlan ?? []
      const index = plan.findIndex((e) => e.day === cmd.day)
      if (index === -1) {
        const entry: MealPlanEntry = { id: `meal-${cmd.day}`, day: cmd.day, text: cmd.text, recipeId: cmd.recipeId, createdAt: now.toISOString() }
        return { ...snapshot, mealPlan: [...plan, entry] }
      }
      const copy = plan.slice()
      copy[index] = { ...copy[index]!, text: cmd.text, recipeId: cmd.recipeId }
      return { ...snapshot, mealPlan: copy }
    }
    case 'meal.clear':
      return { ...snapshot, mealPlan: (snapshot.mealPlan ?? []).filter((e) => e.day !== cmd.day) }

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
