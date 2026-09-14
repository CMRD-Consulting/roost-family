import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { CalendarError, type CalendarSettingsApi } from '@/data/calendarApi'
import type { CalendarStatus } from './manageModel'
import { CALENDAR_ATTEMPT_KEY, useCalendarAttempt } from './useCalendarAttempt'

vi.mock('@/data/householdSource', () => ({ isDemo: false }))

const ATTEMPT = 'attempt_0123456789-abcdefattempt_0123456789'
const SAM = 'membership-sam'

type Target = { client: never; membershipId: string } | null

function setup(query: Record<string, string> = { calendar: 'pending', attempt: ATTEMPT }) {
  const finishOAuth = vi.fn()
  const api = { finishOAuth } as unknown as CalendarSettingsApi
  const status = ref<CalendarStatus | null>(null)
  const target = shallowRef<Target>(null)
  const cleanUrl = vi.fn()
  const scope = effectScope()
  const attempt = scope.run(() =>
    useCalendarAttempt({ query, status, target: () => target.value, offline: () => false, demo: false, api, cleanUrl }),
  )!
  return { finishOAuth, status, target, cleanUrl, scope, attempt }
}

beforeEach(() => sessionStorage.clear())
afterEach(() => sessionStorage.clear())

describe('useCalendarAttempt', () => {
  it('takes the token out of the URL at once, keeping it in memory and sessionStorage for the sign-in', () => {
    const { cleanUrl, attempt, status, scope } = setup()
    expect(cleanUrl).toHaveBeenCalledTimes(1)
    expect(attempt.attempt.value).toBe(ATTEMPT)
    expect(sessionStorage.getItem(CALENDAR_ATTEMPT_KEY)).toBe(ATTEMPT)
    expect(status.value?.kind).toBe('pending')
    scope.stop()
  })

  it('does not touch the URL when it carries no attempt', () => {
    const { cleanUrl, scope } = setup({})
    expect(cleanUrl).not.toHaveBeenCalled()
    scope.stop()
  })

  it('removes the stored token before finishing, so a remount mid-request can’t finish it twice', async () => {
    const { finishOAuth, target, status, scope } = setup()
    let storedDuringRequest: string | null = 'unset'
    finishOAuth.mockImplementation(async () => {
      storedDuringRequest = sessionStorage.getItem(CALENDAR_ATTEMPT_KEY)
      return { connectionId: 'c', calendars: 1, label: 'Google Calendar' }
    })
    target.value = { client: {} as never, membershipId: SAM }
    await flushPromises()
    expect(storedDuringRequest).toBeNull()
    expect(sessionStorage.getItem(CALENDAR_ATTEMPT_KEY)).toBeNull()
    expect(status.value?.kind).toBe('connected')
    scope.stop()
  })

  it.each([
    ['network', true],
    ['internal', true],
    ['forbidden', true],
    ['expired', false],
    ['invalid_attempt', false],
  ] as const)('after %s, the stored token is restored: %s', async (code, restored) => {
    const { finishOAuth, target, scope } = setup()
    finishOAuth.mockRejectedValue(new CalendarError(code))
    target.value = { client: {} as never, membershipId: SAM }
    await flushPromises()
    expect(sessionStorage.getItem(CALENDAR_ATTEMPT_KEY)).toBe(restored ? ATTEMPT : null)
    scope.stop()
  })

  it('shows the outcome when the same adult is still signed in, even if the target object was rebuilt', async () => {
    const { finishOAuth, target, status, attempt, scope } = setup()
    let resolve!: (v: unknown) => void
    finishOAuth.mockImplementation(() => new Promise((r) => (resolve = r)))
    target.value = { client: {} as never, membershipId: SAM }
    await nextTick()
    target.value = { client: {} as never, membershipId: SAM } // e.g. the household list reloaded
    resolve({ connectionId: 'c', calendars: 2, label: 'sam@example.com' })
    await flushPromises()
    expect(status.value).toEqual({ kind: 'connected', message: 'sam@example.com connected — choose which calendars to show and who they belong to.' })
    expect(attempt.reloadKey.value).toBe(1)
    scope.stop()
  })

  it('leaves the status alone when another adult is signed in by the time the answer arrives', async () => {
    const { finishOAuth, target, status, scope } = setup()
    let resolve!: (v: unknown) => void
    finishOAuth.mockImplementation(() => new Promise((r) => (resolve = r)))
    target.value = { client: {} as never, membershipId: SAM }
    await nextTick()
    status.value = null
    target.value = null
    resolve({ connectionId: 'c', calendars: 2, label: 'sam@example.com' })
    await flushPromises()
    expect(status.value).toBeNull()
    scope.stop()
  })
})
