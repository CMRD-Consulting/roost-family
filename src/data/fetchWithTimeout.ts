/** How long any Supabase HTTP request may take before it's treated as a network failure. */
export const REQUEST_TIMEOUT_MS = 12_000

/**
 * `fetch` that aborts after `timeoutMs`. A stalled connection (captive Wi-Fi, a gateway that
 * accepts the socket but never answers) otherwise leaves a request pending forever, so a log
 * would never reach the offline queue. Honors a caller-provided `AbortSignal` too.
 * (No `AbortSignal.any`/`AbortSignal.timeout`: iPadOS 16 Safari lacks them.)
 */
export function createFetchWithTimeout(
  timeoutMs = REQUEST_TIMEOUT_MS,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return (input, init) => {
    const controller = new AbortController()
    const callerSignal = init?.signal
    const onCallerAbort = () => controller.abort(callerSignal?.reason)
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason)
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Request timed out after ${timeoutMs} ms`, 'TimeoutError')),
      timeoutMs,
    )
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    })
  }
}
