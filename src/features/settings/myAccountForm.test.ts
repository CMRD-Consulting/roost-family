import { describe, expect, it } from 'vitest'
import type { Member } from '@/data/snapshot'
import { isLastOwner, validateNewPin } from './myAccountForm'

describe('validateNewPin', () => {
  it('needs 4 digits entered the same twice', () => {
    expect(validateNewPin('12a4', '12a4')).toBe('PINs are 4 digits.')
    expect(validateNewPin('123', '123')).toBe('PINs are 4 digits.')
    expect(validateNewPin('1234', '1243')).toBe('The two PINs don’t match.')
    expect(validateNewPin('1234', '1234')).toBeNull()
  })
})

describe('isLastOwner', () => {
  const sam: Member = { id: 'sam', displayName: 'Sam', color: '#000000', role: 'owner' }
  const alex: Member = { id: 'alex', displayName: 'Alex', color: '#000000', role: 'adult' }

  it('is true only for the one remaining owner', () => {
    expect(isLastOwner([sam, alex], 'sam')).toBe(true)
    expect(isLastOwner([sam, alex], 'alex')).toBe(false)
    expect(isLastOwner([sam, { ...alex, role: 'owner' }], 'sam')).toBe(false)
  })
})
