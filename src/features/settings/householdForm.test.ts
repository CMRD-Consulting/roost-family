import { describe, expect, it } from 'vitest'
import type { HouseholdInfo } from '@/data/snapshot'
import { householdFormFrom, timeZoneOptions, toHouseholdSettingsInput, validateHouseholdForm, type HouseholdForm } from './householdForm'

const HOUSEHOLD: HouseholdInfo = {
  id: 'h1',
  name: 'Rivera',
  zip: '28202',
  timeZone: 'America/New_York',
  defaultNightSleep: { start: '18:00', end: '05:00' },
  nightMode: { start: '20:00', end: '06:00' },
  leaveByBufferMin: 20,
  diaperLogEnabled: false,
  dinnerTonight: null,
  sitterInfo: {},
}

const form = (over: Partial<HouseholdForm> = {}): HouseholdForm => ({ ...householdFormFrom(HOUSEHOLD), ...over })

describe('householdFormFrom', () => {
  it('copies the household settings into editable fields', () => {
    expect(householdFormFrom(HOUSEHOLD)).toEqual({
      name: 'Rivera', zip: '28202', timeZone: 'America/New_York', leaveByBufferMin: 20,
      nightSleepStart: '18:00', nightSleepEnd: '05:00', nightModeStart: '20:00', nightModeEnd: '06:00',
      diaperLogEnabled: false,
    })
  })

  it('treats a missing or null ZIP as empty', () => {
    expect(householdFormFrom({ ...HOUSEHOLD, zip: null }).zip).toBe('')
    const { zip: _zip, ...withoutZip } = HOUSEHOLD
    expect(householdFormFrom(withoutZip).zip).toBe('')
  })
})

describe('validateHouseholdForm', () => {
  it('accepts a valid form', () => {
    expect(validateHouseholdForm(form())).toEqual({})
    expect(validateHouseholdForm(form({ zip: '' }))).toEqual({})
  })

  it('requires a name of at most 80 characters', () => {
    expect(validateHouseholdForm(form({ name: '   ' })).name).toBe('Give your household a name.')
    expect(validateHouseholdForm(form({ name: 'x'.repeat(81) })).name).toBe('Household names can be up to 80 characters.')
  })

  it('checks the ZIP is 5 digits when given', () => {
    expect(validateHouseholdForm(form({ zip: '123' })).zip).toBe('ZIP codes are 5 digits.')
    expect(validateHouseholdForm(form({ zip: ' 28202 ' })).zip).toBeUndefined()
  })

  it('requires a time zone', () => {
    expect(validateHouseholdForm(form({ timeZone: '' })).timeZone).toBe('Pick your time zone.')
  })

  it('keeps the leave-by buffer between 0 and 120 minutes', () => {
    expect(validateHouseholdForm(form({ leaveByBufferMin: 125 })).leaveByBufferMin).toBe('Choose 0 to 120 minutes.')
    expect(validateHouseholdForm(form({ leaveByBufferMin: -5 })).leaveByBufferMin).toBe('Choose 0 to 120 minutes.')
  })

  it('requires both times of each window, and different ones', () => {
    expect(validateHouseholdForm(form({ nightSleepStart: '' })).defaultNightSleep).toBe('Enter a start and an end time.')
    expect(validateHouseholdForm(form({ nightModeEnd: '20:00' })).nightMode).toBe('Start and end must be different times.')
  })
})

describe('toHouseholdSettingsInput', () => {
  it('trims text, turns an empty ZIP into null and groups the time windows', () => {
    expect(toHouseholdSettingsInput(form({ name: '  Rivera-Chen ', zip: '  ', diaperLogEnabled: true }))).toEqual({
      name: 'Rivera-Chen', zip: null, timeZone: 'America/New_York', leaveByBufferMin: 20,
      defaultNightSleep: { start: '18:00', end: '05:00' }, nightMode: { start: '20:00', end: '06:00' },
      diaperLogEnabled: true,
    })
  })
})

describe('timeZoneOptions', () => {
  it('offers the curated list, plus the current zone when it is not in it', () => {
    expect(timeZoneOptions('America/Chicago').map((o) => o.id)).not.toContain('Europe/London')
    const withCurrent = timeZoneOptions('Europe/London')
    expect(withCurrent.at(-1)).toEqual({ id: 'Europe/London', label: 'Europe/London' })
    expect(withCurrent.length).toBe(timeZoneOptions('America/Chicago').length + 1)
  })
})
