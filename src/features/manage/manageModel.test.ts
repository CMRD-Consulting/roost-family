import { describe, expect, it } from 'vitest'
import { SettingsError } from '@/data/settingsApi'
import { calendarStatusFromQuery, initialSelection, isExpiredSession, withoutCalendarStatus } from './manageModel'

const row = (membershipId: string) => ({
  membershipId, householdId: `h-${membershipId}`, householdName: 'Rivera', timeZone: 'UTC', role: 'owner' as const, displayName: 'Sam', color: '#653437',
})

describe('calendarStatusFromQuery', () => {
  it('reads a connected calendar', () => {
    expect(calendarStatusFromQuery({ calendar: 'connected' })).toEqual({ kind: 'connected', message: 'Your calendar is connected.' })
  })

  it('words known error reasons and never echoes an unknown one', () => {
    expect(calendarStatusFromQuery({ calendar: 'error', reason: 'access_denied' })).toEqual({
      kind: 'error', message: 'The calendar wasn’t connected: access wasn’t allowed.',
    })
    expect(calendarStatusFromQuery({ calendar: 'error', reason: 'not_configured' })?.message).toBe(
      'The calendar wasn’t connected: that calendar provider isn’t set up yet.',
    )
    expect(calendarStatusFromQuery({ calendar: 'error', reason: 'expired_state' })?.message).toBe(
      'The calendar wasn’t connected: the connection took too long. Try again.',
    )
    expect(calendarStatusFromQuery({ calendar: 'error', reason: '<script>alert(1)</script>' })?.message).toBe(
      'The calendar wasn’t connected. Try again.',
    )
    expect(calendarStatusFromQuery({ calendar: 'error' })?.message).toBe('The calendar wasn’t connected. Try again.')
  })

  it('ignores anything else', () => {
    expect(calendarStatusFromQuery({})).toBeNull()
    expect(calendarStatusFromQuery({ calendar: 'maybe' })).toBeNull()
    expect(calendarStatusFromQuery({ calendar: ['connected', 'error'] })).toEqual({ kind: 'connected', message: 'Your calendar is connected.' })
  })
})

describe('withoutCalendarStatus', () => {
  it('drops only the calendar keys', () => {
    expect(withoutCalendarStatus({ calendar: 'error', reason: 'x', other: '1' })).toEqual({ other: '1' })
  })
})

describe('initialSelection', () => {
  it('selects the only household, and none when there are several or none', () => {
    expect(initialSelection([row('a')])?.membershipId).toBe('a')
    expect(initialSelection([row('a'), row('b')])).toBeNull()
    expect(initialSelection([])).toBeNull()
  })

  it('keeps a previous choice that is still there', () => {
    expect(initialSelection([row('a'), row('b')], 'b')?.membershipId).toBe('b')
    expect(initialSelection([row('a'), row('b')], 'gone')).toBeNull()
    expect(initialSelection([row('a')], 'gone')?.membershipId).toBe('a')
  })
})

describe('isExpiredSession', () => {
  it('recognizes an ended sign-in', () => {
    expect(isExpiredSession(new SettingsError('JWT expired', 'network'))).toBe(true)
    expect(isExpiredSession(new SettingsError('invalid JWT', 'other'))).toBe(true)
    expect(isExpiredSession(new SettingsError('Auth session missing!', 'other'))).toBe(true)
  })

  it('leaves refusals and network trouble alone', () => {
    expect(isExpiredSession(new SettingsError('only an owner can do that', 'auth'))).toBe(false)
    expect(isExpiredSession(new SettingsError('fetch failed', 'network'))).toBe(false)
    expect(isExpiredSession(new Error('JWT expired'))).toBe(true)
    expect(isExpiredSession('nope')).toBe(false)
  })
})
