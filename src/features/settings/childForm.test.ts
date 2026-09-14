import { describe, expect, it } from 'vitest'
import type { SnapshotChild } from '@/data/snapshot'
import {
  childEditFormFrom, emptyAddChildForm, toAddChildInput, toUpdateChildInput, validateAddChildForm, validateChildEditForm,
} from './childForm'

const TODAY = '2026-09-14'

const ivy: SnapshotChild = {
  id: 'child-1',
  name: 'Ivy',
  birthday: '2023-04-10',
  color: '#2C7F8C',
  nightSleep: null,
  sortOrder: 0,
  overrides: { kidsCorner: false },
  allergies: 'Peanuts',
  foodRules: 'No honey',
}

describe('emptyAddChildForm', () => {
  it('starts blank with the given color', () => {
    expect(emptyAddChildForm('#000')).toEqual({ name: '', birthday: '', color: '#000' })
  })
})

describe('validateAddChildForm', () => {
  it('requires a name and a non-future birthday', () => {
    expect(validateAddChildForm({ name: '  ', birthday: '', color: '#000' }, TODAY)).toEqual({
      name: 'Give this child a name.',
      birthday: 'Enter a birthday.',
    })
    expect(validateAddChildForm({ name: 'Mo', birthday: '2099-01-01', color: '#000' }, TODAY)).toEqual({
      birthday: 'Birthdays can’t be in the future.',
    })
    expect(validateAddChildForm({ name: 'Mo', birthday: '2020-01-01', color: '#000' }, TODAY)).toEqual({})
  })

  it('rejects a name over 40 characters', () => {
    const errors = validateAddChildForm({ name: 'x'.repeat(41), birthday: '2020-01-01', color: '#000' }, TODAY)
    expect(errors.name).toBe('Names can be up to 40 characters.')
  })
})

describe('toAddChildInput', () => {
  it('trims the name', () => {
    expect(toAddChildInput({ name: '  Mo  ', birthday: '2020-01-01', color: '#000' })).toEqual({
      name: 'Mo', birthday: '2020-01-01', color: '#000',
    })
  })
})

describe('childEditFormFrom', () => {
  it('fills from the child, using the household default window when the child has none', () => {
    expect(childEditFormFrom(ivy, { start: '18:00', end: '05:00' })).toEqual({
      name: 'Ivy',
      birthday: '2023-04-10',
      color: '#2C7F8C',
      allergies: 'Peanuts',
      foodRules: 'No honey',
      useHouseholdNightSleep: true,
      nightSleepStart: '18:00',
      nightSleepEnd: '05:00',
      overrides: { kidsCorner: false },
    })
  })

  it('uses the child’s own window when set, and copies overrides so the original is untouched', () => {
    const withWindow: SnapshotChild = { ...ivy, nightSleep: { start: '19:00', end: '06:00' } }
    const form = childEditFormFrom(withWindow, { start: '18:00', end: '05:00' })
    expect(form.useHouseholdNightSleep).toBe(false)
    expect(form.nightSleepStart).toBe('19:00')
    form.overrides.feeding = true
    expect(withWindow.overrides.feeding).toBeUndefined()
  })

  it('defaults missing allergies/foodRules to empty strings', () => {
    const bare: SnapshotChild = { id: 'c', name: 'Theo', birthday: '2025-01-01', color: '#000', nightSleep: null, sortOrder: 0, overrides: {} }
    const form = childEditFormFrom(bare, { start: '18:00', end: '05:00' })
    expect(form.allergies).toBe('')
    expect(form.foodRules).toBe('')
  })
})

describe('validateChildEditForm', () => {
  const base = childEditFormFrom(ivy, { start: '18:00', end: '05:00' })

  it('passes with a valid household-default form', () => {
    expect(validateChildEditForm(base, TODAY)).toEqual({})
  })

  it('requires the night-sleep window to have different times when not using the household default', () => {
    const form = { ...base, useHouseholdNightSleep: false, nightSleepStart: '19:00', nightSleepEnd: '19:00' }
    expect(validateChildEditForm(form, TODAY)).toEqual({ nightSleep: 'Start and end must be different times.' })
  })

  it('does not check the window fields while using the household default', () => {
    const form = { ...base, useHouseholdNightSleep: true, nightSleepStart: '19:00', nightSleepEnd: '19:00' }
    expect(validateChildEditForm(form, TODAY)).toEqual({})
  })
})

describe('toUpdateChildInput', () => {
  it('maps the household-default toggle to a null night-sleep window', () => {
    const form = childEditFormFrom(ivy, { start: '18:00', end: '05:00' })
    expect(toUpdateChildInput('child-1', form)).toEqual({
      childId: 'child-1',
      name: 'Ivy',
      birthday: '2023-04-10',
      color: '#2C7F8C',
      allergies: 'Peanuts',
      foodRules: 'No honey',
      nightSleep: null,
    })
  })

  it('maps a custom window through when the toggle is off', () => {
    const form = { ...childEditFormFrom(ivy, { start: '18:00', end: '05:00' }), useHouseholdNightSleep: false, nightSleepStart: '19:30', nightSleepEnd: '06:30' }
    expect(toUpdateChildInput('child-1', form).nightSleep).toEqual({ start: '19:30', end: '06:30' })
  })
})
