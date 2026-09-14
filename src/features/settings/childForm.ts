import type { AddChildInput, UpdateChildInput } from '@/data/settingsApi'
import type { SnapshotChild } from '@/data/snapshot'
import type { Feature, TimeWindow } from '@/domain/types'
import { LIMITS } from '@/features/setup/validation'

/** Mirrored from the database checks on `update_child` (§7.9). */
export const CHILD_NOTE_MAX = 1000

export interface AddChildForm {
  name: string
  birthday: string
  color: string
}

export type AddChildFormErrors = Partial<Record<'name' | 'birthday', string>>

export function emptyAddChildForm(color: string): AddChildForm {
  return { name: '', birthday: '', color }
}

function validateNameAndBirthday(name: string, birthday: string, today: string): { name?: string; birthday?: string } {
  const errors: { name?: string; birthday?: string } = {}
  const trimmed = name.trim()
  if (!trimmed) errors.name = 'Give this child a name.'
  else if ([...trimmed].length > LIMITS.personName) errors.name = `Names can be up to ${LIMITS.personName} characters.`
  if (!birthday) errors.birthday = 'Enter a birthday.'
  else if (birthday > today) errors.birthday = 'Birthdays can’t be in the future.'
  return errors
}

export function validateAddChildForm(form: AddChildForm, today: string): AddChildFormErrors {
  return validateNameAndBirthday(form.name, form.birthday, today)
}

export function toAddChildInput(form: AddChildForm): AddChildInput {
  return { name: form.name.trim(), birthday: form.birthday, color: form.color }
}

/** The Children section's per-child edit panel (spec §7.9): profile fields, night-sleep window and the
 *  age-based feature overrides, all saved together. */
export interface ChildEditForm {
  name: string
  birthday: string
  color: string
  allergies: string
  foodRules: string
  /** true = the household default window applies (child.nightSleep === null). */
  useHouseholdNightSleep: boolean
  nightSleepStart: string
  nightSleepEnd: string
  overrides: Partial<Record<Feature, boolean>>
}

export type ChildEditFormErrors = Partial<Record<'name' | 'birthday' | 'nightSleep', string>>

export function childEditFormFrom(child: SnapshotChild, householdDefault: TimeWindow): ChildEditForm {
  return {
    name: child.name,
    birthday: child.birthday,
    color: child.color,
    allergies: child.allergies ?? '',
    foodRules: child.foodRules ?? '',
    useHouseholdNightSleep: child.nightSleep === null,
    nightSleepStart: child.nightSleep?.start ?? householdDefault.start,
    nightSleepEnd: child.nightSleep?.end ?? householdDefault.end,
    overrides: { ...child.overrides },
  }
}

export function validateChildEditForm(form: ChildEditForm, today: string): ChildEditFormErrors {
  const errors: ChildEditFormErrors = validateNameAndBirthday(form.name, form.birthday, today)
  if (!form.useHouseholdNightSleep && form.nightSleepStart === form.nightSleepEnd) {
    errors.nightSleep = 'Start and end must be different times.'
  }
  return errors
}

export function toUpdateChildInput(childId: string, form: ChildEditForm): UpdateChildInput {
  return {
    childId,
    name: form.name.trim(),
    birthday: form.birthday,
    color: form.color,
    allergies: form.allergies.trim(),
    foodRules: form.foodRules.trim(),
    nightSleep: form.useHouseholdNightSleep ? null : { start: form.nightSleepStart, end: form.nightSleepEnd },
  }
}
