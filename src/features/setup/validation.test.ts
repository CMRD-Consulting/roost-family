import { describe, it, expect } from 'vitest'
import {
  normalizeInviteCode,
  validateInviteCode,
  validateEmail,
  validateCode,
  validateHousehold,
  validateKids,
  validateMemberName,
  validateDisplayLabel,
  validatePin,
} from './validation'
import { initialTimeZone, US_TIME_ZONES } from './timeZones'

describe('setup validation', () => {
  it('accepts 6-character invite codes, case-insensitive', () => {
    expect(validateInviteCode('roost1')).toBeNull()
    expect(validateInviteCode('ROOS')).toBe('Invite codes are 6 letters or numbers.')
  })

  it('normalizes invite codes to 6 uppercase letters and digits', () => {
    expect(normalizeInviteCode('ro-ost 1')).toBe('ROOST1')
    expect(normalizeInviteCode('roost1xyz')).toBe('ROOST1')
    expect(normalizeInviteCode('é!?')).toBe('')
  })

  it('checks email and 6-digit codes', () => {
    expect(validateEmail('sam@roost.test')).toBeNull()
    expect(validateEmail('sam@')).toBe('Enter a valid email address.')
    expect(validateCode('123456')).toBeNull()
    expect(validateCode('12345')).toBe('Enter the 6-digit code from your email.')
  })

  it('requires a household name of up to 80 characters, an optional 5-digit ZIP and a listed time zone', () => {
    const h = { householdName: 'Rivera', zip: '', timeZone: 'America/New_York' }
    expect(validateHousehold(h)).toBeNull()
    expect(validateHousehold({ ...h, householdName: ' ' })).toBe('Give your household a name.')
    expect(validateHousehold({ ...h, householdName: 'x'.repeat(80) })).toBeNull()
    expect(validateHousehold({ ...h, householdName: 'x'.repeat(81) })).toBe('Household names can be up to 80 characters.')
    expect(validateHousehold({ ...h, zip: '2820' })).toBe('ZIP codes are 5 digits.')
    expect(validateHousehold({ ...h, timeZone: 'America/Detroit' })).toBe('Pick your time zone.')
    expect(validateHousehold({ ...h, timeZone: 'Pacific/Honolulu' })).toBeNull()
  })

  it('requires 1–8 kids with names of up to 40 characters and past birthdays', () => {
    const today = '2026-09-14'
    const kid = { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' }
    expect(validateKids([kid], today)).toBeNull()
    expect(validateKids([], today)).toBe('Add at least one child.')
    expect(validateKids(Array(9).fill(kid), today)).toBe('A household can have up to 8 children.')
    expect(validateKids([{ ...kid, name: '' }], today)).toBe('Every child needs a name.')
    expect(validateKids([{ ...kid, name: 'x'.repeat(40) }], today)).toBeNull()
    expect(validateKids([{ ...kid, name: 'x'.repeat(41) }], today)).toBe('Names can be up to 40 characters.')
    expect(validateKids([{ ...kid, birthday: '2026-09-15' }], today)).toBe('Birthdays can’t be in the future.')
    expect(validateKids([{ ...kid, birthday: '' }], today)).toBe('Every child needs a birthday.')
  })

  it('limits adult and display names to 40 characters, counting code points', () => {
    expect(validateMemberName('Sam')).toBeNull()
    expect(validateMemberName('  ')).toBe('Tell us what to call you.')
    expect(validateMemberName('x'.repeat(41))).toBe('Names can be up to 40 characters.')
    expect(validateMemberName('😀'.repeat(40))).toBeNull()
    expect(validateDisplayLabel('Kitchen')).toBeNull()
    expect(validateDisplayLabel('')).toBe('Name this display.')
    expect(validateDisplayLabel('x'.repeat(41))).toBe('Display names can be up to 40 characters.')
  })

  it('requires matching 4-digit PINs', () => {
    expect(validatePin('1234', '1234')).toBeNull()
    expect(validatePin('123', '123')).toBe('Your PIN is 4 digits.')
    expect(validatePin('1234', '1243')).toBe('The PINs don’t match.')
  })
})

describe('time zones', () => {
  it('offers the seven curated US zones', () => {
    expect(US_TIME_ZONES.map((z) => z.label)).toEqual(['Eastern', 'Central', 'Mountain', 'Arizona', 'Pacific', 'Alaska', 'Hawaii'])
  })

  it('uses a listed detected zone, otherwise defaults to Eastern and asks to pick', () => {
    expect(initialTimeZone('America/Chicago')).toEqual({ id: 'America/Chicago', matched: true })
    expect(initialTimeZone('Europe/London')).toEqual({ id: 'America/New_York', matched: false })
    expect(initialTimeZone(undefined)).toEqual({ id: 'America/New_York', matched: false })
  })
})
