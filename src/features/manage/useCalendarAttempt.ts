import { ref, watch, type Ref } from 'vue'
import type { AdultClient } from '@/data/settingsApi'
import type { CalendarSettingsApi } from '@/data/calendarApi'
import {
  CALENDAR_PENDING_MESSAGE,
  calendarAttemptFromQuery,
  calendarConnectedMessage,
  calendarFinishMessage,
  calendarFinishRetryable,
  validCalendarAttempt,
  type CalendarStatus,
} from './manageModel'

/** sessionStorage key for a returned OAuth attempt token. Only the token is kept there, never a session. */
export const CALENDAR_ATTEMPT_KEY = 'roost-calendar-attempt'

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function readStored(): string | null {
  try {
    return validCalendarAttempt(storage()?.getItem(CALENDAR_ATTEMPT_KEY))
  } catch {
    return null
  }
}

function writeStored(attempt: string | null): void {
  try {
    if (attempt) storage()?.setItem(CALENDAR_ATTEMPT_KEY, attempt)
    else storage()?.removeItem(CALENDAR_ATTEMPT_KEY)
  } catch {
    // Storage blocked: the attempt lives in memory only.
  }
}

export interface CalendarAttemptOptions {
  /** The query the page opened with. */
  query: Parameters<typeof calendarAttemptFromQuery>[0]
  status: Ref<CalendarStatus | null>
  /** The signed-in adult with a household open, or null. */
  target: () => { client: AdultClient } | null
  offline: () => boolean
  demo: boolean
  api: CalendarSettingsApi
  /** Removes `calendar` / `attempt` / `reason` from the URL. */
  cleanUrl: () => void
}

/**
 * A Google / Microsoft connection coming back to Manage household (`?calendar=pending&attempt=…`). The adult's sign-in
 * isn't persisted, so the page reloads at the sign-in step: the attempt token is kept in memory and in sessionStorage
 * (surviving another reload), and finished with `calendar-oauth-finish` as soon as an adult is signed in with a
 * household open. An attempt that expired or is unknown is forgotten; one refused for another adult is kept, so
 * signing in as the right adult finishes it.
 */
export function useCalendarAttempt(options: CalendarAttemptOptions) {
  const attempt = ref<string | null>(options.demo ? null : (calendarAttemptFromQuery(options.query) ?? readStored()))
  writeStored(attempt.value)
  if (attempt.value && !options.status.value) options.status.value = { kind: 'pending', message: CALENDAR_PENDING_MESSAGE }

  /** Bumped after a connection was made, so the calendar list reads again. */
  const reloadKey = ref(0)
  /** The last failure can be tried again with the same attempt. */
  const canRetry = ref(false)
  let running = false

  function forget(): void {
    attempt.value = null
    canRetry.value = false
    writeStored(null)
  }

  async function finish(): Promise<void> {
    const token = attempt.value
    const target = options.target()
    if (!token || !target || running || options.offline()) return
    running = true
    canRetry.value = false
    options.status.value = { kind: 'pending', message: CALENDAR_PENDING_MESSAGE }
    try {
      const result = await options.api.finishOAuth(target.client, token)
      forget()
      if (options.target() === target) {
        options.status.value = { kind: 'connected', message: calendarConnectedMessage(result.label) }
        reloadKey.value += 1
      }
    } catch (e) {
      if (calendarFinishRetryable(e)) canRetry.value = true
      else forget()
      if (options.target() === target) options.status.value = { kind: 'error', message: calendarFinishMessage(e) }
    } finally {
      running = false
      options.cleanUrl()
    }
  }

  watch([options.target, options.offline], () => void finish(), { immediate: true })

  return {
    attempt,
    reloadKey,
    canRetry,
    retry: finish,
    /** The adult dismissed the banner: a failed attempt is dropped. */
    dismiss(): void {
      if (options.status.value?.kind !== 'pending') forget()
    },
  }
}
