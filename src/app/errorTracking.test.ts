import { describe, expect, it } from 'vitest'
import type { Breadcrumb, ErrorEvent as SentryErrorEvent } from '@sentry/vue'
import { hashHouseholdId, scrubBreadcrumb, scrubEvent } from './errorTracking'

const REDACTION_TERMS = ['Ivy', 'Theo', 'Jess', "Children's ibuprofen"]

function baseEvent(overrides: Partial<SentryErrorEvent> = {}): SentryErrorEvent {
  return {
    type: undefined,
    event_id: 'abc123',
    message: 'Something broke',
    ...overrides,
  }
}

describe('scrubEvent', () => {
  it('removes request data, cookies and auth headers, and strips the query string from the URL', () => {
    const event = baseEvent({
      request: {
        url: 'https://roost.cmrd.dev/home?token=secret123',
        method: 'GET',
        data: { pin: '1234' },
        cookies: { session: 'abc' },
        query_string: 'token=secret123',
        headers: { Authorization: 'Bearer xyz', apikey: 'anon-key', 'User-Agent': 'RoostFamily' },
      },
    })

    const result = scrubEvent(event, [], null)

    expect(result.request?.url).toBe('https://roost.cmrd.dev/home')
    expect(result.request).not.toHaveProperty('data')
    expect(result.request).not.toHaveProperty('cookies')
    expect(result.request).not.toHaveProperty('query_string')
    expect(result.request?.headers).not.toHaveProperty('Authorization')
    expect(result.request?.headers).not.toHaveProperty('apikey')
    expect(result.request?.headers?.['User-Agent']).toBe('RoostFamily')
  })

  it('deletes the user field', () => {
    const event = baseEvent({ user: { id: 'user-1', email: 'sam@example.com' } })
    expect(scrubEvent(event, [], null)).not.toHaveProperty('user')
  })

  it('redacts matching names in extra, contexts, exception messages and the top-level message', () => {
    const event = baseEvent({
      message: 'Failed to save dose for Ivy',
      extra: { note: 'Called by Theo at bedtime', unrelated: 42 },
      contexts: { household: { plan: "Give Children's ibuprofen at 6pm" } },
      exception: { values: [{ type: 'Error', value: 'Ivy has an allergy conflict' }] },
    })

    const result = scrubEvent(event, REDACTION_TERMS, null)

    expect(result.message).toBe('[redacted]')
    expect((result.extra as Record<string, unknown>).note).toBe('[redacted]')
    expect((result.extra as Record<string, unknown>).unrelated).toBe(42)
    expect((result.contexts?.household as Record<string, unknown>).plan).toBe('[redacted]')
    expect(result.exception?.values?.[0]?.value).toBe('[redacted]')
  })

  it('leaves fields with no matching name untouched', () => {
    const event = baseEvent({ extra: { note: 'Nothing sensitive here' } })
    const result = scrubEvent(event, REDACTION_TERMS, null)
    expect((result.extra as Record<string, unknown>).note).toBe('Nothing sensitive here')
  })

  it('sets the household tag from the hashed id, and omits it when there is none', () => {
    const withHash = scrubEvent(baseEvent(), [], 'abc123def456')
    expect(withHash.tags?.household).toBe('abc123def456')

    const withoutHash = scrubEvent(baseEvent(), [], null)
    expect(withoutHash.tags?.household).toBeUndefined()
  })

  it('scrubs breadcrumbs attached to the event the same way as top-level breadcrumbs', () => {
    const event = baseEvent({
      breadcrumbs: [{ category: 'fetch', message: 'GET /api', data: { url: 'https://x/y?token=1', body: 'secret' } }],
    })
    const result = scrubEvent(event, [], null)
    expect(result.breadcrumbs?.[0]?.data).not.toHaveProperty('body')
    expect(result.breadcrumbs?.[0]?.data?.url).toBe('https://x/y')
  })
})

describe('scrubBreadcrumb', () => {
  it('drops body fields and strips query strings from fetch/xhr breadcrumb data', () => {
    const crumb: Breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.example/x?apikey=secret', method: 'POST', request_body_size: 12, body: 'sensitive payload' },
    }
    const result = scrubBreadcrumb(crumb, [])
    expect(result?.data).not.toHaveProperty('body')
    expect(result?.data?.url).toBe('https://api.example/x')
    expect(result?.data?.method).toBe('POST')
  })

  it('does not touch data on non-request breadcrumbs', () => {
    const crumb: Breadcrumb = { category: 'ui.click', data: { target: 'button#save' } }
    expect(scrubBreadcrumb(crumb, [])?.data).toEqual({ target: 'button#save' })
  })

  it('redacts a matching name in the breadcrumb message', () => {
    const crumb: Breadcrumb = { category: 'default', message: 'Opened dose form for Theo' }
    expect(scrubBreadcrumb(crumb, REDACTION_TERMS)?.message).toBe('[redacted]')
  })

  it('leaves an unrelated message alone', () => {
    const crumb: Breadcrumb = { category: 'navigation', message: 'Navigated to /home' }
    expect(scrubBreadcrumb(crumb, REDACTION_TERMS)?.message).toBe('Navigated to /home')
  })
})

describe('hashHouseholdId', () => {
  it('is deterministic and 12 hex characters long', async () => {
    const a = await hashHouseholdId('household-123')
    const b = await hashHouseholdId('household-123')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })

  it('differs for different ids', async () => {
    const a = await hashHouseholdId('household-123')
    const b = await hashHouseholdId('household-456')
    expect(a).not.toBe(b)
  })
})
