import { describe, expect, it, vi } from 'vitest'
import { CALENDAR_PROVIDERS, OAUTH_PROVIDERS, calendarProviderEnabled, isOAuthProvider, oauthProviderApi } from './oauthProviders.ts'

describe('CALENDAR_PROVIDERS', () => {
  it('offers Google only: Microsoft is written but switched off', () => {
    expect([...CALENDAR_PROVIDERS]).toEqual(['google'])
    expect(calendarProviderEnabled('google')).toBe(true)
    expect(calendarProviderEnabled('microsoft')).toBe(false)
    // Never a provider at all: an ICS subscription is a link, not an account.
    expect(calendarProviderEnabled('ics')).toBe(false)
    expect(calendarProviderEnabled(null)).toBe(false)
  })

  it('still knows about every provider there is code for, so a switched-off one can be told apart from nonsense', () => {
    expect([...OAUTH_PROVIDERS]).toEqual(['google', 'microsoft'])
    expect(isOAuthProvider('microsoft')).toBe(true)
    expect(isOAuthProvider('ics')).toBe(false)
    expect(isOAuthProvider(undefined)).toBe(false)
  })

  it('keeps the Microsoft wiring intact, ready to be switched back on', () => {
    const api = oauthProviderApi('microsoft', vi.fn())
    expect(api.buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.test/cb', state: 's', codeChallenge: 'c' })).toContain(
      'login.microsoftonline.com',
    )
    expect(api.canWrite('Calendars.ReadWrite')).toBe(true)
  })
})
