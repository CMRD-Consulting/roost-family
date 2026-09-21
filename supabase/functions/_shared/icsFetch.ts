/**
 * Fetching an ICS subscription link safely (spec §5.5): the URL is chosen by a household adult, so the Edge Function
 * must not become a way to reach private networks (SSRF) or to tie up its memory and time.
 *
 * - URLs: `https://` only (`webcal://` and `webcals://` are read as `https://`), no user info, the default port.
 * - Hosts: literal IPs and every address a name resolves to must be public (not loopback, private, CGNAT,
 *   link-local, multicast, reserved, documentation, or IPv6 equivalents including IPv4-mapped and -translated, NAT64
 *   and 6to4 forms); single-label names, `localhost` and names under `.localhost`, `.internal`, `.local`,
 *   `.localdomain` and `.home.arpa` are refused without resolving.
 * - Fetching: a 10 s timeout for the whole exchange (redirects and body), at most 3 redirects with every hop checked
 *   the same way, and a 20 MB download budget enforced while streaming. The body is never held: `icsPrefilter.ts`
 *   reduces it to the blocks today could need as it arrives (spec §5.5), so a years-deep personal export costs tens
 *   of KB of memory instead of failing.
 *
 * `allowPrivateHosts` (the `CALENDAR_ALLOW_PRIVATE_HOSTS=1` environment variable, off by default) skips the host
 * checks and also allows `http://` and non-default ports, so a local `supabase functions serve` can subscribe to a
 * fixture served from the host (`http://host.docker.internal:8123/…`). Never set it in production.
 *
 * Residual risk: the name is resolved here and again by `fetch`, so a DNS-rebinding host could answer differently the
 * second time; Deno's fetch cannot be pinned to the checked address.
 *
 * Error messages never contain the URL (a subscription link is a secret).
 */
import type { FetchLike } from './calendarProvider.ts'
import { ICS_MAX_DOWNLOAD_BYTES, prefilterIcsStream, type IcsPrefilterOptions, type IcsPrefilterResult } from './icsPrefilter.ts'

export type IcsFetchErrorCode =
  /** Not an acceptable URL (scheme, credentials, port, syntax). */
  | 'invalid_url'
  /** The host, or a redirect's target, is not a public address. */
  | 'blocked_host'
  /** Network failure, DNS failure, timeout, too many redirects, or an unexpected HTTP status. */
  | 'unreachable'
  /** 401, 403, 404 or 410: the link was revoked or deleted. */
  | 'gone'
  /**
   * The server declares a body larger than the whole download budget. Nearly unreachable since the streaming
   * pre-filter arrived: a body that merely grows past the budget is read as far as it goes and marked `partial`.
   */
  | 'too_large'

export class IcsFetchError extends Error {
  constructor(
    readonly code: IcsFetchErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'IcsFetchError'
  }
}

/** Resolves a host name to its IPv4 and IPv6 addresses; throws or returns [] when it does not resolve. */
export type ResolveHost = (hostname: string) => Promise<string[]>

export interface IcsFetchOptions {
  fetch: FetchLike
  resolveHost: ResolveHost
  allowPrivateHosts: boolean
  timeoutMs?: number
  /** Decoded bytes to read before giving up on the rest (default `ICS_MAX_DOWNLOAD_BYTES`). */
  maxDownloadBytes?: number
  maxRedirects?: number
  /** Aborts the fetch early (e.g. the events request's overall deadline). */
  signal?: AbortSignal
}

export const ICS_TIMEOUT_MS = 10_000
export const ICS_MAX_REDIRECTS = 3
const URL_MAX = 2048
const GONE_STATUSES = new Set([401, 403, 404, 410])
/** Names that only ever resolve inside a private network; refused without asking DNS. */
const LOCAL_SUFFIXES = ['.localhost', '.internal', '.local', '.localdomain', '.home.arpa']

// ---- URLs ----

/** Why a URL is unacceptable, or null. Assumes webcal has already been rewritten. */
function urlShapeProblem(url: URL, allowPrivateHosts: boolean): string | null {
  if (url.protocol !== 'https:' && !(allowPrivateHosts && url.protocol === 'http:')) return 'scheme must be https'
  if (url.username || url.password) return 'credentials are not allowed in the URL'
  if (url.port && !allowPrivateHosts) return 'only the default port is allowed'
  if (!url.hostname) return 'a host is required'
  return null
}

/** Validates and normalizes a subscription URL typed by an adult. Throws `invalid_url`. */
export function normalizeIcsUrl(raw: unknown, options: { allowPrivateHosts: boolean }): URL {
  if (typeof raw !== 'string') throw new IcsFetchError('invalid_url', 'url must be a string')
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > URL_MAX) throw new IcsFetchError('invalid_url', 'url is empty or too long')
  const rewritten = trimmed.replace(/^webcals?:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(rewritten)
  } catch {
    throw new IcsFetchError('invalid_url', 'url does not parse')
  }
  const problem = urlShapeProblem(url, options.allowPrivateHosts)
  if (problem) throw new IcsFetchError('invalid_url', problem)
  url.hash = ''
  return url
}

// ---- Addresses ----

function parseIpv4(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

function parseIpv6(text: string): number[] | null {
  let s = text.toLowerCase()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (!s.includes(':')) return null
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail)
    if (!v4) return null
    s = `${s.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parseGroups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parseGroups(halves[0]!)
  const rest = halves.length === 2 ? parseGroups(halves[1]!) : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const value = parseInt(g, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

function ipv4IsPrivate([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a! >= 224 // multicast, reserved, broadcast
  )
}

/** True for any address that is not a public unicast address (and for anything unparseable). */
export function isPrivateAddress(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4) return ipv4IsPrivate(v4)
  const b = parseIpv6(address)
  if (!b) return true
  const zeroPrefix = (n: number) => b.slice(0, n).every((x) => x === 0)
  if (zeroPrefix(10) && b[10] === 0xff && b[11] === 0xff) return ipv4IsPrivate(b.slice(12)) // ::ffff:a.b.c.d
  if (zeroPrefix(8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return ipv4IsPrivate(b.slice(12)) // ::ffff:0:a.b.c.d
  if (zeroPrefix(12)) return true // ::, ::1, IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return b.slice(4, 12).every((x) => x === 0) ? ipv4IsPrivate(b.slice(12)) : true // NAT64, local-use NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return ipv4IsPrivate(b.slice(2, 6)) // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] === 0x00 && b[3] === 0x00) || (b[2] === 0x0d && b[3] === 0xb8))) return true // Teredo, documentation
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3]! >= 0x10 && b[3]! <= 0x2f) return true // ORCHID 2001:10::/28, ORCHIDv2 2001:20::/28
  if (b[0] === 0x3f && b[1] === 0xff && (b[2]! & 0xf0) === 0x00) return true // documentation 3fff::/20
  if (b[0] === 0x01 && b[1] === 0x00 && b.slice(2, 8).every((x) => x === 0)) return true // discard 100::/64
  if ((b[0]! & 0xfe) === 0xfc) return true // unique local fc00::/7
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true // link-local fe80::/10
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true // site-local fec0::/10
  if (b[0] === 0xff) return true // multicast
  return false
}

async function assertPublicHost(url: URL, options: IcsFetchOptions): Promise<void> {
  if (options.allowPrivateHosts) return
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (parseIpv4(host) || host.startsWith('[')) {
    if (isPrivateAddress(host)) throw new IcsFetchError('blocked_host', 'the address is not public')
    return
  }
  if (!host.includes('.') || host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new IcsFetchError('blocked_host', 'the host is not a public name')
  }
  let addresses: string[]
  try {
    addresses = await options.resolveHost(host)
  } catch {
    throw new IcsFetchError('unreachable', 'the host name does not resolve')
  }
  if (addresses.length === 0) throw new IcsFetchError('unreachable', 'the host name does not resolve')
  if (addresses.some(isPrivateAddress)) throw new IcsFetchError('blocked_host', 'the host resolves to a non-public address')
}

// ---- Fetching ----

/**
 * Reduces the body to what today could need, without ever holding it. A declared `Content-Length` over the whole
 * download budget is refused before reading — but only when the response is not encoded, since a compressed
 * response's declared length counts compressed bytes while the budget counts the decoded ones the runtime hands us
 * (Google serves these feeds gzipped, usually with no `Content-Length` at all).
 */
async function readFiltered(res: Response, maxDownloadBytes: number, prefilter: IcsPrefilterOptions): Promise<IcsPrefilterResult> {
  const encoded = !!res.headers.get('Content-Encoding')
  const declared = Number(res.headers.get('Content-Length'))
  if (!encoded && Number.isFinite(declared) && declared > maxDownloadBytes) {
    await res.body?.cancel().catch(() => {})
    throw new IcsFetchError('too_large', 'the calendar is too large')
  }
  try {
    return await prefilterIcsStream(res.body, { ...prefilter, maxDownloadBytes })
  } catch (e) {
    if (e instanceof IcsFetchError) throw e
    throw new IcsFetchError('unreachable', `reading the calendar failed: ${e instanceof Error ? e.name : 'error'}`)
  }
}

/**
 * Fetches an already-normalized subscription URL and returns the reduced calendar with what it cost to get there.
 * `prefilter.day` (YYYYMMDD, the household's) keeps only today's blocks; `prefilter.headerOnly` stops at the first
 * VEVENT, which is all `calendar-connect-ics` needs. Throws `IcsFetchError`.
 */
export async function fetchIcsFiltered(url: URL, options: IcsFetchOptions, prefilter: IcsPrefilterOptions = {}): Promise<IcsPrefilterResult> {
  const timeoutMs = options.timeoutMs ?? ICS_TIMEOUT_MS
  const maxDownloadBytes = options.maxDownloadBytes ?? ICS_MAX_DOWNLOAD_BYTES
  const maxRedirects = options.maxRedirects ?? ICS_MAX_REDIRECTS
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new IcsFetchError('unreachable', 'the calendar request timed out'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
  aborted.catch(() => {})

  const run = async (): Promise<IcsPrefilterResult> => {
    let current = url
    for (let hop = 0; ; hop++) {
      await assertPublicHost(current, options)
      if (signal.aborted) throw new IcsFetchError('unreachable', 'the calendar request timed out')
      let res: Response
      try {
        res = await options.fetch(current.href, {
          redirect: 'manual',
          signal,
          headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'RoostFamily (calendar subscription)' },
        })
      } catch (e) {
        throw new IcsFetchError('unreachable', `the calendar request failed: ${e instanceof Error ? e.name : 'error'}`)
      }

      const location = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null
      if (location !== null) {
        await res.body?.cancel().catch(() => {})
        if (hop >= maxRedirects) throw new IcsFetchError('unreachable', 'too many redirects')
        let next: URL
        try {
          next = new URL(location.replace(/^webcals?:\/\//i, 'https://'), current)
        } catch {
          throw new IcsFetchError('unreachable', 'the redirect location does not parse')
        }
        if (urlShapeProblem(next, options.allowPrivateHosts)) throw new IcsFetchError('blocked_host', 'the redirect target is not allowed')
        next.hash = ''
        current = next
        continue
      }
      if (GONE_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => {})
        throw new IcsFetchError('gone', `the calendar link no longer works (HTTP ${res.status})`)
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        throw new IcsFetchError('unreachable', `the calendar server answered HTTP ${res.status}`)
      }
      return await readFiltered(res, maxDownloadBytes, { ...prefilter, signal })
    }
  }

  try {
    return await Promise.race([run(), aborted])
  } finally {
    clearTimeout(timer)
  }
}
