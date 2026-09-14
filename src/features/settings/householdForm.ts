import type { HouseholdSettingsInput } from '@/data/settingsApi'
import type { HouseholdInfo } from '@/data/snapshot'
import { US_TIME_ZONES, type TimeZoneOption } from '@/features/setup/timeZones'
import { LIMITS } from '@/features/setup/validation'

/** The Household section's editable fields. Times are 'HH:MM' (an empty string while a field is cleared). */
export interface HouseholdForm {
  name: string
  zip: string
  timeZone: string
  leaveByBufferMin: number
  nightSleepStart: string
  nightSleepEnd: string
  nightModeStart: string
  nightModeEnd: string
  diaperLogEnabled: boolean
}

export type HouseholdFormErrors = Partial<
  Record<'name' | 'zip' | 'timeZone' | 'leaveByBufferMin' | 'defaultNightSleep' | 'nightMode', string>
>

/** Leave-by buffer stepper bounds, mirrored from the database check. */
export const LEAVE_BY_BUFFER = { min: 0, max: 120, step: 5 } as const

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function householdFormFrom(household: HouseholdInfo): HouseholdForm {
  return {
    name: household.name,
    zip: household.zip ?? '',
    timeZone: household.timeZone,
    leaveByBufferMin: household.leaveByBufferMin,
    nightSleepStart: household.defaultNightSleep.start,
    nightSleepEnd: household.defaultNightSleep.end,
    nightModeStart: household.nightMode.start,
    nightModeEnd: household.nightMode.end,
    diaperLogEnabled: household.diaperLogEnabled,
  }
}

function windowError(start: string, end: string): string | undefined {
  if (!TIME.test(start) || !TIME.test(end)) return 'Enter a start and an end time.'
  if (start === end) return 'Start and end must be different times.'
  return undefined
}

/** Field errors, keyed by field (empty when the form can be saved). */
export function validateHouseholdForm(form: HouseholdForm): HouseholdFormErrors {
  const errors: HouseholdFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give your household a name.'
  else if ([...name].length > LIMITS.householdName) errors.name = `Household names can be up to ${LIMITS.householdName} characters.`
  const zip = form.zip.trim()
  if (zip && !/^\d{5}$/.test(zip)) errors.zip = 'ZIP codes are 5 digits.'
  if (!form.timeZone) errors.timeZone = 'Pick your time zone.'
  const buffer = form.leaveByBufferMin
  if (!Number.isInteger(buffer) || buffer < LEAVE_BY_BUFFER.min || buffer > LEAVE_BY_BUFFER.max) {
    errors.leaveByBufferMin = `Choose ${LEAVE_BY_BUFFER.min} to ${LEAVE_BY_BUFFER.max} minutes.`
  }
  const nightSleep = windowError(form.nightSleepStart, form.nightSleepEnd)
  if (nightSleep) errors.defaultNightSleep = nightSleep
  const nightMode = windowError(form.nightModeStart, form.nightModeEnd)
  if (nightMode) errors.nightMode = nightMode
  return errors
}

export function toHouseholdSettingsInput(form: HouseholdForm): HouseholdSettingsInput {
  const zip = form.zip.trim()
  return {
    name: form.name.trim(),
    zip: zip === '' ? null : zip,
    timeZone: form.timeZone,
    leaveByBufferMin: form.leaveByBufferMin,
    defaultNightSleep: { start: form.nightSleepStart, end: form.nightSleepEnd },
    nightMode: { start: form.nightModeStart, end: form.nightModeEnd },
    diaperLogEnabled: form.diaperLogEnabled,
  }
}

/** The curated US zones, plus the household's current zone when it isn't one of them (so saving never changes it). */
export function timeZoneOptions(current: string): TimeZoneOption[] {
  const options = [...US_TIME_ZONES]
  if (current && !options.some((o) => o.id === current)) options.push({ id: current, label: current })
  return options
}
