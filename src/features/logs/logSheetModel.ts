import { isFeatureEnabled } from '@/domain/ageDefaults'
import type { DoseWarning } from '@/domain/medicine'
import { WAKE_WINDOW_LOOKBACK_MS } from '@/domain/sleep'
import { formatClock, formatDuration, householdDate } from '@/domain/time'
import type { Feature, Medicine, SleepEntry } from '@/domain/types'
import type { Attribution } from '@/data/logCommands'
import type { GroceryItem, HouseholdSnapshot, Member, SitterSession, SnapshotChild } from '@/data/snapshot'
import type { LogKind } from '@/features/main/mainScreenModel'
import { sitterAttribution } from '@/features/sitter/sitterModel'

const DAY_MS = 24 * 3_600_000

const FEATURE_FOR_KIND: Partial<Record<LogKind, Feature>> = {
  feeding: 'feeding',
  sticker: 'kidsCorner',
  diaper: 'diaper',
}

/** Children a kid log of `kind` can be recorded for, in display order. Jots and groceries have none. */
export function eligibleChildren(snapshot: HouseholdSnapshot, kind: LogKind, now: Date): SnapshotChild[] {
  const today = householdDate(now, snapshot.household.timeZone)
  const enabled = (child: SnapshotChild, feature: Feature) =>
    isFeatureEnabled(feature, {
      birthday: child.birthday,
      today,
      overrides: child.overrides,
      diaperLogEnabled: snapshot.household.diaperLogEnabled,
    })
  const t = now.getTime()

  const include = (child: SnapshotChild): boolean => {
    switch (kind) {
      case 'sleep':
        return (
          enabled(child, 'wakeWindow') ||
          snapshot.sleeps.some((e) => e.childId === child.id && t - Date.parse(e.startAt) <= WAKE_WINDOW_LOOKBACK_MS)
        )
      case 'medicine':
        return snapshot.medicines.some((m) => m.childId === child.id)
      case 'jot':
      case 'grocery':
        return false
      default:
        return enabled(child, FEATURE_FOR_KIND[kind]!)
    }
  }

  return snapshot.children.filter(include).sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Pre-select only when there is exactly one child; otherwise an adult must pick (prevents wrong-child logs). */
export function defaultChildId(children: SnapshotChild[]): string | null {
  return children.length === 1 ? children[0]!.id : null
}

/**
 * The child's current open sleep: the latest-started entry with no end. An open entry followed by a
 * sleep that ended after it started is a stray and ignored (spec §7.4), matching `sleepStatus`.
 */
export function openSleepFor(snapshot: HouseholdSnapshot, childId: string): SleepEntry | null {
  const mine = snapshot.sleeps.filter((e) => e.childId === childId)
  const superseded = (open: SleepEntry) => {
    const start = Date.parse(open.startAt)
    return mine.some((e) => e.endAt !== null && Date.parse(e.endAt) > start)
  }
  return (
    mine
      .filter((e) => e.endAt === null && !superseded(e))
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0] ?? null
  )
}

function hoursLabel(hours: number): string {
  return String(Number(hours.toFixed(1)))
}

/** Human copy for medicine warnings (spec §7.4). */
export function doseWarningMessages(warnings: DoseWarning[], medicine: Medicine): string[] {
  const h = hoursLabel(medicine.minIntervalHours)
  return warnings.map((w) => {
    if (w.kind === 'overMax') return `This would be dose ${w.doseNumber} in 24 hours. Maximum is ${w.max}.`
    const by = w.nearestDoseBy ? ` by ${w.nearestDoseBy}` : ''
    const gap = formatDuration(w.gapMs)
    return w.direction === 'before'
      ? `Last dose was ${gap} ago${by}. Minimum is ${h}h.`
      : `Another dose was logged ${gap} after this time${by}. Minimum is ${h}h.`
  })
}

/** The void reason recorded when a dose is undone from the undo toast. */
export const UNDO_DOSE_REASON = 'Undone within 10 seconds'

/** "Every 6h · max 4/day", or "Every 6h" with no daily maximum (shown under a medicine's name). */
export function medicineScheduleLabel(medicine: Medicine): string {
  const every = `Every ${hoursLabel(medicine.minIntervalHours)}h`
  return medicine.maxDosesPer24h === null ? every : `${every} · max ${medicine.maxDosesPer24h}/day`
}

/**
 * Attribution for a kid log: the display it was logged on and the optional "Who?" adult (spec §6.5). During
 * Sitter Mode the sitter replaces the adult.
 */
export function attributionFor(
  identity: { displayId: string } | null,
  membershipId: string | null,
  members: Member[],
  sitter: SitterSession | null = null,
): Attribution {
  if (sitter) return { displayId: identity?.displayId ?? null, loggedByMembershipId: null, ...sitterAttribution(sitter) }
  const member = membershipId === null ? undefined : members.find((m) => m.id === membershipId)
  return {
    displayId: identity?.displayId ?? null,
    loggedByMembershipId: membershipId,
    sitterSessionId: null,
    loggedByName: member?.displayName ?? null,
  }
}

/** "8:02 PM today" / "8:02 PM yesterday" / "8:02 PM on Sep 12" in the household time zone. */
export function startedAtLabel(startAt: Date, now: Date, timeZone: string): string {
  const clock = formatClock(startAt, timeZone)
  const day = householdDate(startAt, timeZone)
  if (day === householdDate(now, timeZone)) return `${clock} today`
  if (day === householdDate(new Date(now.getTime() - DAY_MS), timeZone)) return `${clock} yesterday`
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(startAt)
  return `${clock} on ${date}`
}

/** Feeding amount choices per type (spec §7.4: oz for milk, "a little / some / all" for meals and snacks). */
export function feedingAmounts(type: 'milk' | 'meal' | 'snack'): string[] {
  return type === 'milk' ? ['2 oz', '4 oz', '6 oz', '8 oz'] : ['A little', 'Some', 'All']
}

/** The grocery sheet's list: unchecked items first (oldest first), then items checked in the last 24 h. */
export function visibleGroceries(items: GroceryItem[], now: Date): GroceryItem[] {
  const t = now.getTime()
  const byCreated = (a: GroceryItem, b: GroceryItem) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
  const unchecked = items.filter((i) => i.checkedAt === null).sort(byCreated)
  const checked = items
    .filter((i) => i.checkedAt !== null && t - Date.parse(i.checkedAt) < DAY_MS)
    .sort(byCreated)
  return [...unchecked, ...checked]
}
