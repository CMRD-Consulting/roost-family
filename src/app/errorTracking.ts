import { watch } from 'vue'
import type { App } from 'vue'
import type { Router } from 'vue-router'
import type { Breadcrumb, BrowserOptions, ErrorEvent as SentryErrorEvent } from '@sentry/vue'
import { useHouseholdStore } from '@/stores/householdStore'

export type GetRedactionTerms = () => string[]

const REDACTED = '[redacted]'

/** Drops the query string and fragment: they can carry one-time tokens (e.g. `?attempt=` on /manage). */
function stripQueryString(url: string | undefined): string | undefined {
  if (!url) return url
  const i = url.search(/[?#]/)
  return i === -1 ? url : url.slice(0, i)
}

/** Breadcrumb data keys that hold a URL or route path. */
const URL_KEYS = new Set(['url', 'from', 'to'])

function stripUrlFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) out[key] = URL_KEYS.has(key) && typeof value === 'string' ? stripQueryString(value) : value
  return out
}

function containsRedactionTerm(value: string, terms: string[]): boolean {
  if (value.length === 0 || terms.length === 0) return false
  const lower = value.toLowerCase()
  return terms.some((term) => term.trim().length > 0 && lower.includes(term.toLowerCase()))
}

/** Recursively replaces any string containing one of `terms` with `[redacted]`, leaving other values as-is. */
function redactDeep<T>(value: T, terms: string[]): T {
  if (typeof value === 'string') {
    return (containsRedactionTerm(value, terms) ? REDACTED : value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, terms)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = redactDeep(item, terms)
    return out as T
  }
  return value
}

const BODY_KEY_PATTERN = /body/i

/** Drops any request/response body field from breadcrumb data (fetch/xhr breadcrumbs, spec §5.9). */
function stripBodyFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (BODY_KEY_PATTERN.test(key)) continue
    out[key] = key === 'url' && typeof value === 'string' ? stripQueryString(value) : value
  }
  return out
}

/**
 * Pure event scrubber for Sentry's `beforeSend` (spec §5.9): drops request bodies/cookies/auth headers,
 * strips query strings from URLs, deletes the `user` field, redacts any string in `extra`/`contexts`/
 * exception messages matching a name in `redactionTerms`, and tags the event with the hashed household id.
 */
export function scrubEvent(
  event: SentryErrorEvent,
  redactionTerms: string[],
  householdHash: string | null,
): SentryErrorEvent {
  const next: SentryErrorEvent = { ...event }

  if (next.request) {
    const headers = next.request.headers ? { ...next.request.headers } : undefined
    if (headers) {
      delete headers.Authorization
      delete headers.authorization
      delete headers.apikey
      delete headers.apiKey
    }
    // data, cookies, query_string and env are intentionally not carried over.
    next.request = {
      method: next.request.method,
      url: stripQueryString(next.request.url),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    }
  }

  delete next.user

  if (next.extra) next.extra = redactDeep(next.extra, redactionTerms)
  if (next.contexts) next.contexts = redactDeep(next.contexts, redactionTerms)
  if (next.message !== undefined) next.message = redactDeep(next.message, redactionTerms)
  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((value) => ({
        ...value,
        value: value.value !== undefined ? redactDeep(value.value, redactionTerms) : value.value,
      })),
    }
  }
  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb, redactionTerms))
      .filter((crumb): crumb is Breadcrumb => crumb !== null)
  }

  if (householdHash) next.tags = { ...next.tags, household: householdHash }

  return next
}

/** Pure breadcrumb scrubber for Sentry's `beforeBreadcrumb` (spec §5.9). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb, redactionTerms: string[]): Breadcrumb | null {
  const next: Breadcrumb = { ...breadcrumb }
  if (next.message !== undefined) next.message = redactDeep(next.message, redactionTerms)
  if (next.data) {
    const isRequestCrumb = next.category === 'fetch' || next.category === 'xhr'
    next.data = redactDeep(stripUrlFields(isRequestCrumb ? stripBodyFields(next.data) : next.data), redactionTerms)
  }
  return next
}

/** SHA-256 of `id`, truncated to 12 hex characters — enough to correlate events from one household
 *  without storing or transmitting the real id (spec §5.9). */
export async function hashHouseholdId(id: string): Promise<string> {
  const bytes = new TextEncoder().encode(id)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 12)
}

export interface SentryInitInput {
  app: App
  dsn: string
  integrations: NonNullable<BrowserOptions['integrations']>
  getRedactionTerms: GetRedactionTerms
  householdHash: () => string | null
}

/**
 * The options for `Sentry.init`. `attachProps: false`: the Vue error handler would otherwise attach the failing
 * component's props, which can hold calendar events and other household data.
 */
export function sentryInitOptions(input: SentryInitInput): BrowserOptions & { app: App; attachProps: false } {
  return {
    app: input.app,
    dsn: input.dsn,
    sendDefaultPii: false,
    attachProps: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    integrations: input.integrations,
    beforeSend: (event) => scrubEvent(event, input.getRedactionTerms(), input.householdHash()),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb, input.getRedactionTerms()),
  }
}

/**
 * Wires up optional Sentry error tracking (spec §5.9). A no-op unless `VITE_SENTRY_DSN` is set, so the
 * Sentry SDK — imported dynamically here — never reaches the bundle of a build without a DSN.
 */
export function initErrorTracking(app: App, router: Router, getRedactionTerms: GetRedactionTerms): void {
  const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  const householdStore = useHouseholdStore()
  let householdHash: string | null = null
  const refreshHouseholdHash = () => {
    const id = householdStore.view?.household.id ?? null
    if (id === null) {
      householdHash = null
      return
    }
    void hashHouseholdId(id).then((hash) => {
      householdHash = hash
    })
  }
  refreshHouseholdHash()
  watch(() => householdStore.view?.household.id, refreshHouseholdHash)

  void import('@sentry/vue').then((Sentry) => {
    Sentry.init(
      sentryInitOptions({
        app,
        dsn,
        integrations: [Sentry.browserTracingIntegration({ router })],
        getRedactionTerms,
        householdHash: () => householdHash,
      }),
    )
  })
}
