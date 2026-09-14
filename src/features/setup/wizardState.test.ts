import { describe, it, expect } from 'vitest'
import { nextStep, previousStep } from './wizardState'

describe('wizard steps', () => {
  it('moves forward through the steps', () => {
    expect(nextStep('welcome')).toBe('invite')
    expect(nextStep('display')).toBe('display')
  })

  it('goes back one step', () => {
    expect(previousStep('kids')).toBe('household')
    expect(previousStep('welcome')).toBe('welcome')
    expect(previousStep('consent')).toBe('signIn')
  })

  it('skips Sign in when going back from Consent with an adult signed in', () => {
    expect(previousStep('consent', { signedIn: true })).toBe('invite')
    expect(previousStep('household', { signedIn: true })).toBe('consent')
    expect(nextStep('invite', { signedIn: true })).toBe('consent')
    expect(nextStep('invite')).toBe('signIn')
  })
})
