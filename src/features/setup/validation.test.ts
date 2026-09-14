import { describe, it, expect } from 'vitest'
import { validateInviteCode, validateEmail, validateCode, validateHousehold, validateKids, validatePin } from './validation'

describe('setup validation', () => {
  it('accepts 6-character invite codes, case-insensitive', () => {
    expect(validateInviteCode('roost1')).toBeNull()
    expect(validateInviteCode('ROOS')).toBe('Invite codes are 6 letters or numbers.')
  })

  it('checks email and 6-digit codes', () => {
    expect(validateEmail('sam@roost.test')).toBeNull()
    expect(validateEmail('sam@')).toBe('Enter a valid email address.')
    expect(validateCode('123456')).toBeNull()
    expect(validateCode('12345')).toBe('Enter the 6-digit code from your email.')
  })

  it('requires a household name and an optional 5-digit ZIP', () => {
    expect(validateHousehold({ householdName: 'Rivera', zip: '' })).toBeNull()
    expect(validateHousehold({ householdName: ' ', zip: '' })).toBe('Give your household a name.')
    expect(validateHousehold({ householdName: 'Rivera', zip: '2820' })).toBe('ZIP codes are 5 digits.')
  })

  it('requires 1–8 kids with names and past birthdays', () => {
    const today = '2026-09-14'
    const kid = { name: 'Ivy', birthday: '2023-04-10', color: '#C2477A' }
    expect(validateKids([kid], today)).toBeNull()
    expect(validateKids([], today)).toBe('Add at least one child.')
    expect(validateKids(Array(9).fill(kid), today)).toBe('A household can have up to 8 children.')
    expect(validateKids([{ ...kid, name: '' }], today)).toBe('Every child needs a name.')
    expect(validateKids([{ ...kid, birthday: '2026-09-15' }], today)).toBe('Birthdays can’t be in the future.')
    expect(validateKids([{ ...kid, birthday: '' }], today)).toBe('Every child needs a birthday.')
  })

  it('requires matching 4-digit PINs', () => {
    expect(validatePin('1234', '1234')).toBeNull()
    expect(validatePin('123', '123')).toBe('Your PIN is 4 digits.')
    expect(validatePin('1234', '1243')).toBe('The PINs don’t match.')
  })
})
