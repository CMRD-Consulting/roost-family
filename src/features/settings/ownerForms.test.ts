import { describe, expect, it } from 'vitest'
import type { MemberRow } from '@/data/settingsApi'
import { confirmsHouseholdName, formatJoined, formatLastSeen, isOnlyOwner, roleLabel, validateNewMember } from './ownerForms'

const NOW = new Date('2026-09-14T19:00:00Z')
const NY = 'America/New_York'

function member(membershipId: string, role: MemberRow['role']): MemberRow {
  return { membershipId, displayName: membershipId, color: '#653437', role, joinedAt: null }
}

describe('formatLastSeen', () => {
  it('words the last heartbeat relative to now', () => {
    expect(formatLastSeen(null, NOW)).toBe('Never checked in')
    expect(formatLastSeen('2026-09-14T18:59:30Z', NOW)).toBe('Last seen just now')
    expect(formatLastSeen('2026-09-14T18:59:00Z', NOW)).toBe('Last seen 1 minute ago')
    expect(formatLastSeen('2026-09-14T18:15:00Z', NOW)).toBe('Last seen 45 minutes ago')
    expect(formatLastSeen('2026-09-14T16:00:00Z', NOW)).toBe('Last seen 3 hours ago')
    expect(formatLastSeen('2026-09-13T18:00:00Z', NOW)).toBe('Last seen 1 day ago')
    expect(formatLastSeen('2026-09-04T18:00:00Z', NOW)).toBe('Last seen 10 days ago')
  })

  it('treats a clock slightly ahead of this tablet as just now', () => {
    expect(formatLastSeen('2026-09-14T19:00:20Z', NOW)).toBe('Last seen just now')
  })
})

describe('formatJoined', () => {
  it('shows the household date, or nothing when unknown', () => {
    expect(formatJoined('2026-01-02T03:00:00Z', NY)).toBe('Joined Jan 1, 2026')
    expect(formatJoined(null, NY)).toBeNull()
  })
})

describe('roles', () => {
  it('labels roles', () => {
    expect(roleLabel('owner')).toBe('Owner')
    expect(roleLabel('adult')).toBe('Adult')
    expect(roleLabel('caregiver')).toBe('Caregiver')
  })

  it('knows the only owner', () => {
    const rows = [member('sam', 'owner'), member('alex', 'adult')]
    expect(isOnlyOwner(rows, 'sam')).toBe(true)
    expect(isOnlyOwner(rows, 'alex')).toBe(false)
    expect(isOnlyOwner([...rows, member('pat', 'owner')], 'sam')).toBe(false)
  })
})

describe('validateNewMember', () => {
  const ok = { name: ' Pat ', color: '#653437', pin: '1357', pinAgain: '1357' }

  it('accepts a name, a color and a 4-digit PIN typed twice', () => {
    expect(validateNewMember(ok)).toBeNull()
  })

  it('explains what is missing', () => {
    expect(validateNewMember({ ...ok, name: '  ' })).toBe('Tell us what to call you.')
    expect(validateNewMember({ ...ok, color: null })).toBe('Pick a color.')
    expect(validateNewMember({ ...ok, pin: '12' })).toBe('PINs are 4 digits.')
    expect(validateNewMember({ ...ok, pinAgain: '7531' })).toBe('The two PINs don’t match.')
  })
})

describe('confirmsHouseholdName', () => {
  it('matches the household name exactly, ignoring surrounding spaces', () => {
    expect(confirmsHouseholdName(' Rivera ', 'Rivera')).toBe(true)
    expect(confirmsHouseholdName('rivera', 'Rivera')).toBe(false)
    expect(confirmsHouseholdName('', 'Rivera')).toBe(false)
  })
})
