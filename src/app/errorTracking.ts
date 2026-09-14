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

const PATH_TOKEN_RULES: Array<[RegExp, string]> = [
  // The Take list link (spec §7.8): the token is the only credential for the phone page.
  [/\/list\/[^/?#\s"'`<>]+/g, '/list/[token]'],
  // The emailed export link (spec §11.3): not a credential, but it identifies one household's export.
  [/\/manage\/export\/[^/?#\s"'`<>]+/g, '/manage/export/[id]'],
]

/**
 * Replaces credentials carried in a URL path: `/list/<token>` → `/list/[token]` and `/manage/export/<id>` →
 * `/manage/export/[id]`, wherever they appear in `value` (a URL, a route path or free text). Idempotent.
 */
export function scrubPathTokens(value: string): string {
  let out = value
  for (const [pattern, replacement] of PATH_TOKEN_RULES) out = out.replace(pattern, replacement)
  return out
}

/** A URL or route path with its query string, fragment and path tokens removed. */
function scrubUrl(url: string): string {
  return scrubPathTokens(stripQueryString(url) ?? url)
}

/** Recursively applies `fn` to every string in `value`. */
function mapStringsDeep<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as unknown as T
  if (Array.isArray(value)) return value.map((item) => mapStringsDeep(item, fn)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = mapStringsDeep(item, fn)
    return out as T
  }
  return value
}

/** Breadcrumb data keys that hold a URL or route path. */
const URL_KEYS = new Set(['url', 'from', 'to'])

function stripUrlFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) out[key] = URL_KEYS.has(key) && typeof value === 'string' ? scrubUrl(value) : value
  return out
}

function containsRedactionTerm(value: string, terms: string[]): boolean {
  if (value.length === 0 || terms.length === 0) return false
  const lower = value.toLowerCase()
  return terms.some((term) => term.trim().length > 0 && lower.includes(term.toLowerCase()))
}

/** Recursively replaces any string containing one of `terms` with `[redacted]`, leaving other values as-is. */
function redactDeep<T>(value: T, terms: string[]): T {
  return mapStringsDeep(value, (s) => (containsRedactionTerm(s, terms) ? REDACTED : s))
}

/** Request/response payload keys on fetch/xhr breadcrumbs: `body`, `request_body_size`, `responseBody`, … and the
 *  raw `request`, `response` and `input` objects some SDK versions and wrappers attach. */
const BODY_KEY_PATTERN = /body|^(request|response|input)$/i

/** Drops any request/response body field from breadcrumb data (fetch/xhr breadcrumbs, spec §5.9). */
function stripBodyFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (BODY_KEY_PATTERN.test(key)) continue
    out[key] = value
  }
  return out
}

/** Console breadcrumbs at these levels are kept (without their arguments); the rest are dropped. */
const KEPT_CONSOLE_LEVELS = new Set(['error', 'fatal'])

/**
 * Console breadcrumbs carry whatever was logged, which can be household free text (spec §5.9). Below error level
 * they are dropped. An error keeps only a string first argument — the developer's own message — as its message;
 * `data.arguments` (and the joined message of every argument) never leave the device.
 */
function scrubConsoleBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!KEPT_CONSOLE_LEVELS.has(breadcrumb.level ?? '')) return null
  const { arguments: args, ...rest } = breadcrumb.data ?? {}
  const first = Array.isArray(args) ? (args as unknown[])[0] : undefined
  return { ...breadcrumb, message: typeof first === 'string' ? first : 'console.error', data: rest }
}

/**
 * Pure event scrubber for Sentry's `beforeSend` (spec §5.9): drops request bodies/cookies/auth headers,
 * strips query strings from URLs, deletes the `user` field, redacts any string in `extra`/`contexts`/
 * exception messages matching a name in `redactionTerms`, removes path tokens (`/list/<token>`) from every string
 * in the event, and tags the event with the hashed household id.
 */
export function scrubEvent(
  event: SentryErrorEvent,
  redactionTerms: string[],
  householdHash: string | null,
): SentryErrorEvent {
  let next: SentryErrorEvent = { ...event }

  if (next.request) {
    const headers = next.request.headers ? { ...next.request.headers } : undefined
    if (headers) {
      delete headers.Authorization
      delete headers.authorization
      delete headers.apikey
      delete headers.apiKey
      for (const key of ['Referer', 'referer']) {
        if (typeof headers[key] === 'string') headers[key] = scrubUrl(headers[key])
      }
    }
    // data, cookies, query_string and env are intentionally not carried over.
    next.request = {
      method: next.request.method,
      url: next.request.url === undefined ? undefined : scrubUrl(next.request.url),
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

  // Last, over the whole event: the page URL reaches request.url, transaction, tags, contexts (the router
  // integration's span data holds the raw route params) and breadcrumbs, and could reach anything else.
  next = mapStringsDeep(next, scrubPathTokens)
  const trace = next.contexts?.trace as { data?: Record<string, unknown> } | undefined
  if (trace?.data) {
    for (const key of Object.keys(trace.data)) {
      if (/^(url\.path\.parameter|params|query)\./.test(key)) delete trace.data[key]
    }
  }

  return next
}

/** Pure breadcrumb scrubber for Sentry's `beforeBreadcrumb` (spec §5.9). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb, redactionTerms: string[]): Breadcrumb | null {
  let next: Breadcrumb | null = { ...breadcrumb }
  if (next.category === 'console') {
    next = scrubConsoleBreadcrumb(next)
    if (next === null) return null
  }
  if (next.message !== undefined) next.message = scrubPathTokens(redactDeep(next.message, redactionTerms))
  if (next.data) {
    const isRequestCrumb = next.category === 'fetch' || next.category === 'xhr'
    next.data = mapStringsDeep(
      redactDeep(stripUrlFields(isRequestCrumb ? stripBodyFields(next.data) : next.data), redactionTerms),
      scrubPathTokens,
    )
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
 * Options for the Vue router integration. Its only use here is naming events by route: tracing is off
 * (`tracesSampleRate: 0`), and page-load and navigation spans would record every route param — the Take list token
 * included — as span data. `routeLabel: 'path'` names the transaction by the matched pattern (`/list/:token`),
 * never the visited path.
 */
export function tracingIntegrationOptions<R>(router: R): { router: R; routeLabel: 'path'; instrumentPageLoad: false; instrumentNavigation: false } {
  return { router, routeLabel: 'path', instrumentPageLoad: false, instrumentNavigation: false }
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
        integrations: [Sentry.browserTracingIntegration(tracingIntegrationOptions(router))],
        getRedactionTerms,
        householdHash: () => householdHash,
      }),
    )
  })
}
