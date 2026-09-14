import { TZDate } from '@date-fns/tz'
import { startOfHouseholdDay } from '@/domain/time'

/**
 * Milliseconds from `now` until the next local midnight in `timeZone`. Used to schedule
 * a reload of "today"/"tomorrow" data (routine progress, day overrides) right when the
 * household's calendar day rolls over.
 *
 * Uses `TZDate` day arithmetic (not a flat +24h) so a DST transition day, whose local
 * midnight-to-midnight span is 23 or 25 hours, still lands on the correct wall-clock
 * midnight rather than drifting an hour off.
 */
export function msUntilNextHouseholdMidnight(now: Date, timeZone: string): number {
  const todayMidnight = new TZDate(startOfHouseholdDay(now, timeZone).getTime(), timeZone)
  const tomorrowMidnight = new TZDate(todayMidnight.getTime(), timeZone)
  tomorrowMidnight.setDate(todayMidnight.getDate() + 1)
  return tomorrowMidnight.getTime() - now.getTime()
}
