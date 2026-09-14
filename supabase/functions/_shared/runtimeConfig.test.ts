import { describe, expect, it, vi } from 'vitest'
import { LOCAL_FINGERPRINT_KEY, isLocalSupabaseUrl, readCalendarRuntimeConfig } from './runtimeConfig.ts'

const env = (values: Record<string, string>) => (name: string) => values[name]

describe('isLocalSupabaseUrl', () => {
  it.each(['http://kong:8000', 'http://127.0.0.1:55321', 'http://localhost:54321', 'http://host.docker.internal:55321'])('%s is local', (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(true)
  })

  it.each(['https://abcd.supabase.co', 'https://kong.example.com', 'https://localhost.example.com', '', 'not a url'])('%s is not local', (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(false)
  })
})

describe('readCalendarRuntimeConfig', () => {
  it('honours CALENDAR_ALLOW_PRIVATE_HOSTS only on a local stack', () => {
    const warn = vi.fn()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'http://kong:8000', CALENDAR_ALLOW_PRIVATE_HOSTS: '1' }), warn).allowPrivateHosts).toBe(true)
    expect(warn).not.toHaveBeenCalled()

    const prod = readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co', CALENDAR_ALLOW_PRIVATE_HOSTS: '1' }), warn)
    expect(prod.allowPrivateHosts).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('CALENDAR_ALLOW_PRIVATE_HOSTS')

    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'http://kong:8000' }), warn).allowPrivateHosts).toBe(false)
  })

  it('defaults APP_URL locally and fails closed in production', () => {
    const warn = vi.fn()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'http://kong:8000' }), warn).appUrl).toBe('http://localhost:5173')
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co' }), warn).appUrl).toBeNull()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co', APP_URL: 'https://roost.example.com/' }), warn).appUrl).toBe(
      'https://roost.example.com',
    )
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co', APP_URL: 'javascript:alert(1)' }), warn).appUrl).toBeNull()
  })

  it('requires CALENDAR_FINGERPRINT_KEY in production and has a local default', () => {
    const warn = vi.fn()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'http://127.0.0.1:55321' }), warn).fingerprintKey).toBe(LOCAL_FINGERPRINT_KEY)
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co' }), warn).fingerprintKey).toBeNull()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co', CALENDAR_FINGERPRINT_KEY: 'short' }), warn).fingerprintKey).toBeNull()
    const key = 'k'.repeat(32)
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co', CALENDAR_FINGERPRINT_KEY: key }), warn).fingerprintKey).toBe(key)
  })

  it('derives the OAuth redirect URI from SUPABASE_URL unless overridden', () => {
    const warn = vi.fn()
    expect(readCalendarRuntimeConfig(env({ SUPABASE_URL: 'https://abcd.supabase.co/' }), warn).oauthRedirectUri).toBe(
      'https://abcd.supabase.co/functions/v1/calendar-oauth-callback',
    )
    expect(
      readCalendarRuntimeConfig(env({ SUPABASE_URL: 'http://kong:8000', CALENDAR_OAUTH_REDIRECT_URI: 'http://localhost:55321/functions/v1/calendar-oauth-callback' }), warn)
        .oauthRedirectUri,
    ).toBe('http://localhost:55321/functions/v1/calendar-oauth-callback')
  })
})
