import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Breadcrumb, ErrorEvent as SentryErrorEvent } from '@sentry/vue'
import { hashHouseholdId, scrubBreadcrumb, scrubEvent, scrubPathTokens, sentryInitOptions, tracingIntegrationOptions } from './errorTracking'

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

describe('URLs in breadcrumbs (OAuth attempt tokens, spec §5.9)', () => {
  it('strips query strings and fragments from navigation breadcrumb from/to', () => {
    const crumb: Breadcrumb = {
      category: 'navigation',
      data: { from: '/manage?calendar=pending&attempt=secretToken', to: 'https://roost.cmrd.dev/manage#access_token=abc' },
    }
    expect(scrubBreadcrumb(crumb, [])?.data).toEqual({ from: '/manage', to: 'https://roost.cmrd.dev/manage' })
  })

  it('strips query strings from a url on any breadcrumb, and from navigation crumbs attached to an event', () => {
    expect(scrubBreadcrumb({ category: 'ui.click', data: { url: '/manage?attempt=x', target: 'button' } }, [])?.data).toEqual({
      url: '/manage',
      target: 'button',
    })
    const event = scrubEvent(baseEvent({ breadcrumbs: [{ category: 'navigation', data: { from: '/a?attempt=1', to: '/b' } }] }), [], null)
    expect(event.breadcrumbs?.[0]?.data).toEqual({ from: '/a', to: '/b' })
  })
})

describe('index.html', () => {
  it('sends only the origin as the referrer, so a URL token never leaves in a Referer header', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain('<meta name="referrer" content="strict-origin" />')
  })
})

describe('sentryInitOptions', () => {
  it('never attaches component props (they can hold calendar events) and sends no PII', () => {
    const options = sentryInitOptions({ app: {} as never, dsn: 'https://x@example.ingest.sentry.io/1', integrations: [], getRedactionTerms: () => [], householdHash: () => null })
    expect(options.attachProps).toBe(false)
    expect(options.sendDefaultPii).toBe(false)
    const crumb = options.beforeBreadcrumb!({ category: 'navigation', data: { to: '/manage?attempt=t' } }, undefined)
    expect(crumb?.data).toEqual({ to: '/manage' })
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

// A real Take list token: 32 random bytes, base64url, 43 characters.
const TOKEN = 'q3Z9_xYv-4LmN0pQrStUvWxYz12345678AbCdEfGhIj'
const EXPORT_ID = '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b'

describe('path tokens (Take list links, export ids; spec §5.9)', () => {
  it('the fixture token is a real 43-character base64url token', () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('scrubPathTokens replaces /list/<token> and /manage/export/<id>, and leaves other paths alone', () => {
    expect(scrubPathTokens(`https://roost.cmrd.dev/list/${TOKEN}`)).toBe('https://roost.cmrd.dev/list/[token]')
    expect(scrubPathTokens(`/list/${TOKEN}?x=1`)).toBe('/list/[token]?x=1')
    expect(scrubPathTokens(`Navigated to /list/${TOKEN}`)).toBe('Navigated to /list/[token]')
    expect(scrubPathTokens(`/manage/export/${EXPORT_ID}`)).toBe('/manage/export/[id]')
    expect(scrubPathTokens('/list/[token]')).toBe('/list/[token]')
    expect(scrubPathTokens('/home')).toBe('/home')
    expect(scrubPathTokens('/manage')).toBe('/manage')
  })

  it('scrubs the token from event.request.url and a Referer header', () => {
    const event = baseEvent({
      request: {
        url: `https://roost.cmrd.dev/list/${TOKEN}`,
        headers: { Referer: `https://roost.cmrd.dev/list/${TOKEN}?from=qr`, 'User-Agent': 'Safari' },
      },
    })
    const result = scrubEvent(event, [], null)
    expect(result.request?.url).toBe('https://roost.cmrd.dev/list/[token]')
    expect(result.request?.headers?.Referer).toBe('https://roost.cmrd.dev/list/[token]')
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('scrubs the token from event.transaction, tags, contexts and extra', () => {
    const event = baseEvent({
      transaction: `/list/${TOKEN}`,
      tags: { url: `https://roost.cmrd.dev/list/${TOKEN}` },
      contexts: {
        trace: { trace_id: 't', span_id: 's', data: { 'url.path.parameter.token': TOKEN, 'params.token': TOKEN, 'url.full': `/list/${TOKEN}` } },
        page: { href: `https://roost.cmrd.dev/manage/export/${EXPORT_ID}` },
      },
      extra: { location: `/list/${TOKEN}` },
    })
    const result = scrubEvent(event, [], null)
    expect(result.transaction).toBe('/list/[token]')
    expect(result.tags?.url).toBe('https://roost.cmrd.dev/list/[token]')
    expect((result.contexts?.page as Record<string, unknown>).href).toBe('https://roost.cmrd.dev/manage/export/[id]')
    expect((result.extra as Record<string, unknown>).location).toBe('/list/[token]')
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(JSON.stringify(result)).not.toContain(EXPORT_ID)
  })

  it('scrubs the token from navigation breadcrumbs (from, to), url keys and messages, top-level and on events', () => {
    const nav: Breadcrumb = { category: 'navigation', data: { from: '/home', to: `/list/${TOKEN}` } }
    expect(scrubBreadcrumb(nav, [])?.data).toEqual({ from: '/home', to: '/list/[token]' })
    const back: Breadcrumb = { category: 'navigation', data: { from: `https://roost.cmrd.dev/list/${TOKEN}#top`, to: '/manage' } }
    expect(scrubBreadcrumb(back, [])?.data).toEqual({ from: 'https://roost.cmrd.dev/list/[token]', to: '/manage' })
    const fetchCrumb: Breadcrumb = { category: 'fetch', data: { url: `https://roost.cmrd.dev/list/${TOKEN}`, method: 'GET' } }
    expect(scrubBreadcrumb(fetchCrumb, [])?.data?.url).toBe('https://roost.cmrd.dev/list/[token]')
    const click: Breadcrumb = { category: 'ui.click', message: `a[href="/list/${TOKEN}"]` }
    expect(scrubBreadcrumb(click, [])?.message).toBe('a[href="/list/[token]"]')

    const event = scrubEvent(baseEvent({ breadcrumbs: [nav, back, fetchCrumb, click] }), [], null)
    expect(JSON.stringify(event)).not.toContain(TOKEN)
  })

  it('scrubs the token from exception messages', () => {
    const event = baseEvent({ exception: { values: [{ type: 'Error', value: `Failed to load /list/${TOKEN}` }] } })
    expect(scrubEvent(event, [], null).exception?.values?.[0]?.value).toBe('Failed to load /list/[token]')
  })

  it('the router integration names transactions by route pattern and records no navigation or page-load spans', () => {
    const router = {} as never
    expect(tracingIntegrationOptions(router)).toEqual({
      router,
      routeLabel: 'path',
      instrumentPageLoad: false,
      instrumentNavigation: false,
    })
  })
})

describe('console and request breadcrumbs (free text, spec §5.9)', () => {
  it('drops console breadcrumbs below error level', () => {
    for (const level of ['log', 'info', 'debug', 'warning'] as const) {
      const crumb: Breadcrumb = { category: 'console', level, message: 'Sam fed Ivy', data: { arguments: ['Sam fed Ivy'], logger: 'console' } }
      expect(scrubBreadcrumb(crumb, []), level).toBeNull()
    }
  })

  it('keeps error-level console breadcrumbs without their arguments, using only a string first argument as the message', () => {
    const crumb: Breadcrumb = {
      category: 'console',
      level: 'error',
      message: 'Save failed {"note":"Ivy has a fever"}',
      data: { arguments: ['Save failed', { note: 'Ivy has a fever' }], logger: 'console' },
    }
    const result = scrubBreadcrumb(crumb, [])
    expect(result?.message).toBe('Save failed')
    expect(result?.data).toEqual({ logger: 'console' })
    expect(JSON.stringify(result)).not.toContain('fever')

    const objectFirst = scrubBreadcrumb({ category: 'console', level: 'error', message: '[object Object]', data: { arguments: [{ a: 1 }] } }, [])
    expect(objectFirst?.message).toBe('console.error')
    expect(objectFirst?.data).toEqual({})
  })

  it('still redacts names and path tokens in a kept console message', () => {
    const named = scrubBreadcrumb({ category: 'console', level: 'error', message: 'x', data: { arguments: ['Dose for Ivy failed'] } }, REDACTION_TERMS)
    expect(named?.message).toBe('[redacted]')
    const pathy = scrubBreadcrumb({ category: 'console', level: 'error', message: 'x', data: { arguments: [`Load /list/${TOKEN} failed`] } }, [])
    expect(pathy?.message).toBe('Load /list/[token] failed')
  })

  it('removes request and response bodies from fetch and xhr breadcrumbs, whatever the key', () => {
    for (const category of ['fetch', 'xhr']) {
      const crumb: Breadcrumb = {
        category,
        data: {
          url: 'https://api.example/rest/v1/rpc/take_list_items',
          method: 'POST',
          status_code: 200,
          body: '{"p_token":"x"}',
          request_body: '{"p_pin":"1234"}',
          requestBody: '{}',
          response_body: '[]',
          responseBody: '[]',
          request_body_size: 20,
          request: { body: '{"p_pin":"1234"}' },
          response: { body: '[]' },
          input: ['https://api.example', { body: '{"p_pin":"1234"}' }],
        },
      }
      expect(scrubBreadcrumb(crumb, [])?.data, category).toEqual({
        url: 'https://api.example/rest/v1/rpc/take_list_items',
        method: 'POST',
        status_code: 200,
      })
    }
  })
})
