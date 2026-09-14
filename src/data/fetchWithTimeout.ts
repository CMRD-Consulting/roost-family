/** How long any Supabase HTTP request may take before it's treated as a network failure. */
export const REQUEST_TIMEOUT_MS = 12_000

/**
 * `fetch` that gives up after `timeoutMs`. A stalled connection (captive Wi-Fi, a gateway that accepts the
 * socket but never answers) otherwise leaves a request pending forever, so a log would never reach the
 * offline queue. Honors a caller-provided `AbortSignal` too.
 * (No `AbortSignal.any`/`AbortSignal.timeout`: iPadOS 16 Safari lacks them.)
 *
 * - The timeout aborts with a `DOMException` named `AbortError` (message "Request timed out after N ms").
 *   postgrest-js retries a rejected GET up to 3 times with back-off unless the error's name is `AbortError`
 *   (or its code `ABORT_ERR`); a `TimeoutError` would turn one 12 s stall into roughly 55 s.
 * - The deadline covers the whole response, body included: when a body is present it is passed through a
 *   `TransformStream`, and the timer is cleared only once the body has finished arriving (or failed). If the
 *   deadline passes first, the request is aborted and the passthrough is errored with the same reason, so a
 *   body read rejects even if the underlying fetch ignores the abort after the headers. Without a body,
 *   without `TransformStream`, or for a response that can't be re-wrapped (e.g. an opaque one), the timer
 *   is cleared when the headers arrive.
 */
export function createFetchWithTimeout(
  timeoutMs = REQUEST_TIMEOUT_MS,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    const callerSignal = init?.signal
    let bodyController: TransformStreamDefaultController<Uint8Array> | null = null
    let finished = false

    const fail = (reason: unknown) => {
      controller.abort(reason)
      if (bodyController !== null && !finished) {
        try {
          bodyController.error(reason)
        } catch {
          // Already closed or errored.
        }
      }
    }
    const onCallerAbort = () => fail(callerSignal?.reason)
    const timer = setTimeout(() => fail(new DOMException(`Request timed out after ${timeoutMs} ms`, 'AbortError')), timeoutMs)
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }

    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason)
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }

    let response: Response
    try {
      response = await baseFetch(input, { ...init, signal: controller.signal })
    } catch (e) {
      finish()
      throw e
    }

    const wrapped = passThroughBody(response, (c) => (bodyController = c), finish)
    if (wrapped === null) finish()
    return wrapped ?? response
  }
}

/**
 * Re-wraps `response` so its body flows through a `TransformStream`, calling `onDone` once the body has
 * fully arrived, failed or been cancelled. Returns null when the response has no body or can't be re-wrapped.
 */
function passThroughBody(
  response: Response,
  onController: (controller: TransformStreamDefaultController<Uint8Array>) => void,
  onDone: () => void,
): Response | null {
  const source = response.body
  if (source === null || typeof TransformStream === 'undefined') return null
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start: onController })
  let wrapped: Response
  try {
    wrapped = new Response(stream.readable, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch {
    return null
  }
  for (const key of ['url', 'redirected'] as const) {
    try {
      Object.defineProperty(wrapped, key, { value: response[key] })
    } catch {
      // Not redefinable here; the defaults are harmless.
    }
  }
  source.pipeTo(stream.writable).then(onDone, onDone)
  return wrapped
}
