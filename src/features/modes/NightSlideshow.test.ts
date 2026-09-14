import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { HouseholdPhoto } from '@/data/snapshot'
import NightSlideshow from './NightSlideshow.vue'
import { nightSeed, shuffledOrder, slotAt } from './slideshow'

const urlApi = vi.hoisted(() => ({
  version: 1,
  offline: false,
  signedUrls: null as unknown as ReturnType<typeof vi.fn>,
}))

vi.mock('@/data/photosApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosApi')>()),
  loadPhotoUrlApi: async () => ({ signedUrls: urlApi.signedUrls }),
}))

const TZ = 'America/New_York'
const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
/** 10:00 PM EDT, exactly on a minute boundary. */
const NIGHT = new Date('2026-09-15T02:00:00Z')

const photo = (n: number): HouseholdPhoto => ({
  id: `dddddddd-0000-0000-0000-00000000000${n}`,
  storagePath: `${HOUSEHOLD}/dddddddd-0000-0000-0000-00000000000${n}.jpg`,
  kind: 'slideshow',
  addedAt: '2026-09-01T12:00:00Z',
})
const PHOTOS = [photo(1), photo(2), photo(3), photo(4)]
const byId = new Map(PHOTOS.map((p) => [p.id, p]))

/** URLs whose image fails to load. */
let failing: Set<string>
/** Every URL an Image was asked to load. */
let requested: string[]

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decoding = 'auto'
  set src(url: string) {
    requested.push(url)
    setTimeout(() => (failing.has(url) || urlApi.offline ? this.onerror?.() : this.onload?.()), 5)
  }
}

function setReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))
}

const signed = (p: HouseholdPhoto, version = 1) => `https://signed.test/${p.storagePath}?v=${version}`

/** The photo ids in the order this night shows them, starting at the current slot. */
function expectedOrder(photos = PHOTOS, at = Date.now()): string[] {
  const order = shuffledOrder(photos.map((p) => p.id), nightSeed(new Date(at), TZ))
  const start = slotAt(at) % order.length
  return [...order.slice(start), ...order.slice(0, start)]
}

async function settle(ms = 20) {
  await vi.advanceTimersByTimeAsync(ms)
  await flushPromises()
}

function slides(w: VueWrapper) {
  return w.findAll('[data-testid="night-slide"]').map((s) => ({
    id: s.attributes('data-photo-id'),
    src: s.attributes('src'),
    active: s.attributes('data-active') === 'true',
    style: s.attributes('style') ?? '',
  }))
}

function activeId(w: VueWrapper) {
  return slides(w).find((s) => s.active)?.id
}

let wrapper: VueWrapper | undefined

function mountSlideshow(photos = PHOTOS) {
  wrapper = mount(NightSlideshow, { props: { photos, timeZone: TZ } })
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NIGHT)
  failing = new Set()
  requested = []
  urlApi.version = 1
  urlApi.offline = false
  urlApi.signedUrls = vi.fn(async (paths: string[]) => {
    if (urlApi.offline) throw new TypeError('Failed to fetch')
    return new Map(paths.map((path) => [path, `https://signed.test/${path}?v=${urlApi.version}`]))
  })
  vi.stubGlobal('Image', FakeImage)
  setReducedMotion(false)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('NightSlideshow', () => {
  it('signs every photo once for an hour and shows this minute’s photo once it has loaded', async () => {
    const w = mountSlideshow()
    expect(slides(w)).toEqual([])
    await settle()
    expect(urlApi.signedUrls).toHaveBeenCalledTimes(1)
    expect(urlApi.signedUrls).toHaveBeenCalledWith(PHOTOS.map((p) => p.storagePath), 3600)
    const [first, second] = expectedOrder()
    expect(slides(w)).toEqual([expect.objectContaining({ id: first, src: signed(byId.get(first!)!), active: true })])
    // The next photo is preloaded ahead of its minute.
    expect(requested).toContain(signed(byId.get(second!)!))
    expect(w.emitted('showing')?.at(-1)).toEqual([true])
    expect(w.find('[data-testid="night-scrim"]').exists()).toBe(true)
  })

  it('crossfades to the next photo every 60 seconds, then drops the old one', async () => {
    const w = mountSlideshow()
    await settle()
    const [first, second, third] = expectedOrder()

    await settle(60_000 - 20)
    const during = slides(w)
    expect(during.map((s) => [s.id, s.active])).toEqual(expect.arrayContaining([[second, true], [first, false]]))
    const outgoing = during.find((s) => s.id === first)!
    expect(outgoing.style).toContain('opacity: 0')
    expect(outgoing.style).toContain('transition: opacity 1500ms')

    await settle(1_500)
    expect(slides(w).map((s) => s.id)).toEqual([second])

    await settle(60_000 - 1_500)
    expect(activeId(w)).toBe(third)
  })

  it('with Reduce Motion, swaps photos instantly', async () => {
    setReducedMotion(true)
    const w = mountSlideshow()
    await settle()
    const [, second] = expectedOrder()
    await settle(60_000)
    expect(slides(w)).toEqual([expect.objectContaining({ id: second, active: true })])
    expect(slides(w)[0]!.style).not.toContain('transition: opacity')
  })

  it('keeps the same order for the whole night across remounts (a peek and back)', async () => {
    const w = mountSlideshow()
    await settle()
    const order = expectedOrder()
    await settle(60_000 - 20)
    expect(activeId(w)).toBe(order[1])
    w.unmount()

    await settle(2 * 60_000)
    const again = mountSlideshow()
    await settle()
    expect(activeId(again)).toBe(order[3])
  })

  it('skips a photo whose image fails to load', async () => {
    const [first, second] = expectedOrder()
    failing.add(signed(byId.get(first!)!))
    const w = mountSlideshow()
    await settle(50)
    expect(activeId(w)).toBe(second)
  })

  it('refreshes the signed URLs 5 minutes before they expire and loads photos from the new URLs', async () => {
    const w = mountSlideshow()
    await settle()
    urlApi.version = 2
    await settle(55 * 60_000 - 20)
    expect(urlApi.signedUrls).toHaveBeenCalledTimes(2)
    await settle(60_000)
    const shown = slides(w).find((s) => s.active)!
    expect(shown.src).toBe(signed(byId.get(shown.id!)!, 2))
  })

  it('offline: keeps cycling the photos already loaded and retries the URLs every minute', async () => {
    const w = mountSlideshow()
    await settle()
    const order = expectedOrder()
    await settle(60_000 - 20) // second photo shown; third preloaded
    urlApi.offline = true
    await settle(54 * 60_000)
    const callsWhileOffline = urlApi.signedUrls.mock.calls.length
    await settle(60_000)
    expect(urlApi.signedUrls.mock.calls.length).toBe(callsWhileOffline + 1)
    // Only photos that loaded while online are shown, and the slideshow keeps moving between them.
    const seen = new Set<string>()
    for (let i = 0; i < 8; i++) {
      await settle(60_000)
      const id = activeId(w)
      expect(id).toBeDefined()
      seen.add(id!)
    }
    expect(seen.size).toBeGreaterThan(1)
    for (const id of seen) expect(order).toContain(id)
  })

  it('shows nothing when no photo can be loaded (the clock alone)', async () => {
    urlApi.offline = true
    const w = mountSlideshow()
    await settle(100)
    expect(slides(w)).toEqual([])
    expect(w.find('[data-testid="night-scrim"]').exists()).toBe(false)
    expect(w.emitted('showing')?.at(-1)).toEqual([false])
  })

  it('moves on when the photo on screen is deleted', async () => {
    const w = mountSlideshow()
    await settle()
    const [first, second] = expectedOrder()
    await w.setProps({ photos: PHOTOS.filter((p) => p.id !== first) })
    await settle(50)
    expect(activeId(w)).not.toBe(first)
    expect(slides(w).some((s) => s.id === first && s.active)).toBe(false)
    expect(activeId(w)).toBeDefined()
    expect([second, ...expectedOrder(PHOTOS.filter((p) => p.id !== first))]).toContain(activeId(w))
  })

  it('signs a newly added photo', async () => {
    const w = mountSlideshow(PHOTOS.slice(0, 2))
    await settle()
    await w.setProps({ photos: PHOTOS })
    await settle()
    expect(urlApi.signedUrls).toHaveBeenLastCalledWith(PHOTOS.map((p) => p.storagePath), 3600)
  })
})
