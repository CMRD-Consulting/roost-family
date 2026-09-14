import { describe, expect, it, vi } from 'vitest'
import { IcsFetchError, fetchIcsText, isPrivateAddress, normalizeIcsUrl, type IcsFetchOptions } from './icsFetch.ts'

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

function codeOf(run: () => unknown): string | null {
  try {
    run()
  } catch (e) {
    if (e instanceof IcsFetchError) return e.code
    throw e
  }
  return null
}

async function asyncCodeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
  } catch (e) {
    if (e instanceof IcsFetchError) return e.code
    throw e
  }
  return null
}

function options(overrides: Partial<IcsFetchOptions> = {}): IcsFetchOptions {
  return {
    fetch: vi.fn(async () => new Response(ICS, { status: 200 })),
    resolveHost: vi.fn(async () => ['93.184.215.14']),
    allowPrivateHosts: false,
    ...overrides,
  }
}

describe('normalizeIcsUrl', () => {
  it('turns webcal:// into https:// and drops the fragment', () => {
    expect(normalizeIcsUrl('  webcal://calendar.example.com/feed.ics?k=1#x ', { allowPrivateHosts: false }).href).toBe(
      'https://calendar.example.com/feed.ics?k=1',
    )
    expect(normalizeIcsUrl('WEBCALS://calendar.example.com/a.ics', { allowPrivateHosts: false }).href).toBe(
      'https://calendar.example.com/a.ics',
    )
    expect(normalizeIcsUrl('https://calendar.example.com/a.ics', { allowPrivateHosts: false }).href).toBe(
      'https://calendar.example.com/a.ics',
    )
  })

  it('rejects other schemes, credentials, non-default ports and junk', () => {
    const prod = { allowPrivateHosts: false }
    for (const url of [
      'http://calendar.example.com/a.ics',
      'ftp://calendar.example.com/a.ics',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@calendar.example.com/a.ics',
      'https://user@calendar.example.com/a.ics',
      'https://calendar.example.com:8443/a.ics',
      'not a url',
      '',
      `https://calendar.example.com/${'a'.repeat(2100)}`,
      42,
      null,
    ]) {
      expect(codeOf(() => normalizeIcsUrl(url, prod)), String(url)).toBe('invalid_url')
    }
  })

  it('with CALENDAR_ALLOW_PRIVATE_HOSTS allows http and other ports (local verification only)', () => {
    expect(normalizeIcsUrl('http://host.docker.internal:8123/f.ics', { allowPrivateHosts: true }).href).toBe(
      'http://host.docker.internal:8123/f.ics',
    )
    expect(codeOf(() => normalizeIcsUrl('https://u:p@host.docker.internal/f.ics', { allowPrivateHosts: true }))).toBe('invalid_url')
  })
})

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:c0a8:0101::1',
    '2001:db8::1',
    '100::1',
    '::ffff:0:127.0.0.1',
    '::ffff:0:10.1.2.3',
    '192.88.99.1',
    '2001:10::1',
    '2001:1f::1',
    '2001:20::1',
    '3fff::1',
    '3fff:fff::1',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '::ffff:0:8.8.8.8', '192.88.100.1', '2001:4860::8888', '3fff:1000::1'])(
    '%s is public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false)
    },
  )

  it('treats unparseable addresses as private', () => {
    expect(isPrivateAddress('nonsense')).toBe(true)
    expect(isPrivateAddress('1.2.3')).toBe(true)
  })
})

describe('fetchIcsText', () => {
  const url = new URL('https://calendar.example.com/feed.ics')

  it('fetches the text with a manual redirect policy', async () => {
    const opts = options()
    expect(await fetchIcsText(url, opts)).toBe(ICS)
    expect(opts.fetch).toHaveBeenCalledWith('https://calendar.example.com/feed.ics', expect.objectContaining({ redirect: 'manual' }))
    expect(opts.resolveHost).toHaveBeenCalledWith('calendar.example.com')
  })

  it('refuses literal private IPs, local names and hosts resolving to private addresses, without fetching', async () => {
    for (const [target, resolved] of [
      ['https://127.0.0.1/a.ics', []],
      ['https://[::1]/a.ics', []],
      ['https://169.254.169.254/latest/meta-data', []],
      ['https://localhost/a.ics', ['127.0.0.1']],
      ['https://kong/a.ics', ['172.18.0.5']],
      ['https://metadata.google.internal/a.ics', ['93.184.215.14']],
      ['https://host.docker.internal/a.ics', ['93.184.215.14']],
      ['https://printer.local/a.ics', ['93.184.215.14']],
      ['https://nas.localdomain/a.ics', ['93.184.215.14']],
      ['https://router.home.arpa./a.ics', ['93.184.215.14']],
      ['https://intranet.example.com/a.ics', ['10.0.0.8']],
      ['https://mixed.example.com/a.ics', ['93.184.215.14', 'fd00::5']],
    ] as const) {
      const opts = options({ resolveHost: vi.fn(async () => [...resolved]) })
      expect(await asyncCodeOf(fetchIcsText(new URL(target), opts)), target).toBe('blocked_host')
      expect(opts.fetch).not.toHaveBeenCalled()
    }
  })

  it('allows private hosts when configured, without resolving', async () => {
    const opts = options({ allowPrivateHosts: true })
    expect(await fetchIcsText(new URL('http://host.docker.internal:8123/f.ics'), opts)).toBe(ICS)
    expect(opts.resolveHost).not.toHaveBeenCalled()
  })

  it('is unreachable when the name does not resolve', async () => {
    const opts = options({ resolveHost: vi.fn(async () => { throw new Error('NXDOMAIN') }) })
    expect(await asyncCodeOf(fetchIcsText(url, opts))).toBe('unreachable')
  })

  it('follows up to 3 redirects, checking every hop', async () => {
    const fetch = vi.fn(async (href: string) => {
      const n = Number(new URL(href).searchParams.get('n') ?? '0')
      if (n < 3) return new Response(null, { status: 302, headers: { Location: `/feed.ics?n=${n + 1}` } })
      return new Response(ICS, { status: 200 })
    })
    const opts = options({ fetch })
    expect(await fetchIcsText(url, opts)).toBe(ICS)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(opts.resolveHost).toHaveBeenCalledTimes(4)
  })

  it('stops after a 4th redirect', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 301, headers: { Location: 'https://calendar.example.com/again.ics' } }))
    expect(await asyncCodeOf(fetchIcsText(url, options({ fetch })))).toBe('unreachable')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('refuses a redirect to a private host, to http, or with credentials', async () => {
    for (const location of ['https://internal.example.com/x.ics', 'http://calendar.example.com/x.ics', 'https://u:p@calendar.example.com/x']) {
      const fetch = vi.fn(async (href: string) =>
        href === url.href ? new Response(null, { status: 302, headers: { Location: location } }) : new Response(ICS),
      )
      const resolveHost = vi.fn(async (host: string) => (host === 'internal.example.com' ? ['192.168.0.10'] : ['93.184.215.14']))
      expect(await asyncCodeOf(fetchIcsText(url, options({ fetch, resolveHost }))), location).toBe('blocked_host')
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('reports a revoked or deleted link as gone, and other failures as unreachable', async () => {
    for (const status of [401, 403, 404, 410]) {
      const fetch = vi.fn(async () => new Response('nope', { status }))
      expect(await asyncCodeOf(fetchIcsText(url, options({ fetch }))), String(status)).toBe('gone')
    }
    for (const status of [500, 503, 429, 400]) {
      const fetch = vi.fn(async () => new Response('nope', { status }))
      expect(await asyncCodeOf(fetchIcsText(url, options({ fetch }))), String(status)).toBe('unreachable')
    }
    const fetch = vi.fn(async () => {
      throw new TypeError('connection refused')
    })
    expect(await asyncCodeOf(fetchIcsText(url, options({ fetch })))).toBe('unreachable')
  })

  it('refuses a declared Content-Length over the cap without reading', async () => {
    const fetch = vi.fn(async () => new Response('x', { headers: { 'Content-Length': String(2_000_000) } }))
    expect(await asyncCodeOf(fetchIcsText(url, options({ fetch, maxBytes: 1_000_000 })))).toBe('too_large')
  })

  it('stops streaming a body that grows past the cap and cancels it', async () => {
    let pulled = 0
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(100_000))
      },
      cancel,
    })
    const fetch = vi.fn(async () => new Response(body))
    expect(await asyncCodeOf(fetchIcsText(url, options({ fetch, maxBytes: 1_000_000 })))).toBe('too_large')
    expect(pulled).toBeLessThan(15)
    expect(cancel).toHaveBeenCalled()
  })

  it('times out a server that never finishes', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'))
      },
    })
    const fetch = vi.fn(async (_href: string, init?: RequestInit) => {
      const response = new Response(body)
      init?.signal?.addEventListener('abort', () => void body.cancel().catch(() => {}))
      return response
    })
    expect(await asyncCodeOf(fetchIcsText(url, options({ fetch, timeoutMs: 20 })))).toBe('unreachable')
  })

  it('stops when the caller\'s signal aborts', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(
      (_href: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    )
    const pending = asyncCodeOf(fetchIcsText(url, options({ fetch, signal: controller.signal })))
    controller.abort()
    expect(await pending).toBe('unreachable')
  })

  it('never puts the URL in error messages', async () => {
    const secretUrl = new URL('https://calendar.example.com/private/SECRET-TOKEN/basic.ics')
    const fetch = vi.fn(async () => new Response('nope', { status: 404 }))
    try {
      await fetchIcsText(secretUrl, options({ fetch }))
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SECRET-TOKEN')
      expect(String((e as Error).message)).not.toContain('calendar.example.com')
    }
  })
})
