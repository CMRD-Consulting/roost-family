import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { buildDemoSnapshot } from '@/data/demo/demoFixture'
import { SettingsError, type SettingsApi } from '@/data/settingsApi'
import type { HouseholdPhoto } from '@/data/snapshot'
import { clearReloadHolds, hasReloadHold } from '@/app/reloadHolds'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import PhotosSection from './sections/PhotosSection.vue'
import { resetSettingsApiLoaderForTests } from './settingsApiLoader'
import { SETTINGS_SECTIONS } from './settingsNav'

const api = vi.hoisted(() => ({ current: null as unknown }))
const photos = vi.hoisted(() => ({
  prepareImage: null as unknown as Mock<(file: Blob) => Promise<Blob>>,
  signedUrls: null as unknown as Mock<(paths: string[], seconds: number) => Promise<Map<string, string>>>,
}))

vi.mock('@/data/householdSource', () => ({ isDemo: false, selectSettingsApi: async () => api.current }))
vi.mock('@/data/supabase', () => {
  throw new Error('Supabase client loaded by a settings test')
})
vi.mock('@/data/photosApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/photosApi')>()),
  prepareImage: (file: Blob) => photos.prepareImage(file),
  loadPhotoUrlApi: async () => ({ signedUrls: photos.signedUrls }),
}))

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const SAM = 'bbbbbbbb-0000-0000-0000-000000000001'
const SAM_AUTH = { membershipId: SAM, pin: '1234' }

const photo = (n: number, kind: HouseholdPhoto['kind'] = 'slideshow'): HouseholdPhoto => {
  const id = `dddddddd-0000-0000-0000-${String(n).padStart(12, '0')}`
  return { id, storagePath: `${HOUSEHOLD}/${id}.jpg`, kind, addedAt: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() }
}

type Fake = SettingsApi & Record<'settingsVerify' | 'uploadPhoto' | 'addPhoto' | 'deletePhoto', ReturnType<typeof vi.fn>>

let pinia: Pinia
let settingsApi: Fake
let uploads = 0

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

async function settle() {
  await vi.advanceTimersByTimeAsync(50)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function setPhotos(list: HouseholdPhoto[]) {
  const store = useHouseholdStore()
  store.snapshot = { ...store.snapshot!, photos: list }
}

async function mountSection(list: HouseholdPhoto[]): Promise<VueWrapper> {
  useHouseholdStore().snapshot = { ...buildDemoSnapshot(new Date()), photos: list }
  const session = useSettingsSessionStore()
  session.init(settingsApi)
  await session.enter(SAM, '1234')
  const w = mount(PhotosSection, { global: { plugins: [pinia] }, attachTo: document.body })
  await settle()
  return w
}

function buttonByText(w: VueWrapper, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

async function chooseFiles(w: VueWrapper, files: File[]) {
  const input = w.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  pinia = createPinia()
  setActivePinia(pinia)
  uploads = 0
  settingsApi = {
    settingsVerify: vi.fn().mockResolvedValue({ role: 'owner', displayName: 'Sam' }),
    uploadPhoto: vi.fn(async () => `eeeeeeee-0000-0000-0000-00000000000${++uploads}`),
    addPhoto: vi.fn().mockResolvedValue(undefined),
    deletePhoto: vi.fn().mockResolvedValue(undefined),
  } as never
  api.current = settingsApi
  photos.prepareImage = vi.fn(async (file: Blob) => {
    if ((file as File).name.startsWith('broken')) {
      const { PhotoDecodeError } = await import('@/data/photosApi')
      throw new PhotoDecodeError()
    }
    return new Blob([`prepared ${(file as File).name}`], { type: 'image/jpeg' })
  })
  photos.signedUrls = vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed.test/${p}`])))
})

afterEach(() => {
  document.body.innerHTML = ''
  setOnline(true)
  resetSettingsApiLoaderForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Settings > Photos', () => {
  it('is in the nav right after Sitter info, with a PIN session only', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(ids.indexOf('photos')).toBe(ids.indexOf('sitter-info') + 1)
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'photos')).toEqual({ id: 'photos', label: 'Photos', ownerSignIn: false })
  })

  it('shows the slideshow photos newest first from signed URLs, the count and the privacy note', async () => {
    const w = await mountSection([photo(1), photo(2), photo(3, 'avatar'), photo(4)])
    expect(w.find('h2').text()).toBe('Photos')
    expect(w.text()).toContain('3 of 200')
    expect(photos.signedUrls).toHaveBeenCalledWith([photo(4), photo(2), photo(1)].map((p) => p.storagePath), 3600)
    const thumbs = w.findAll('[data-testid="photo-thumb"] img')
    expect(thumbs.map((t) => t.attributes('src'))).toEqual([4, 2, 1].map((n) => `https://signed.test/${photo(n).storagePath}`))
    expect(w.text()).toContain('Photos are resized and location data is removed before upload.')
    w.unmount()
  })

  it('shows an empty state with no photos', async () => {
    const w = await mountSection([])
    expect(w.text()).toContain('0 of 200')
    expect(w.text()).toContain('No photos yet')
    expect(photos.signedUrls).not.toHaveBeenCalled()
    w.unmount()
  })

  it('adds photos one at a time: prepares, uploads and adds each, and skips a file that fails to decode', async () => {
    const w = await mountSection([photo(1)])
    const input = w.get('input[type="file"]')
    expect(input.attributes('accept')).toBe('image/*')
    expect(input.attributes('multiple')).toBeDefined()

    await chooseFiles(w, [new File(['a'], 'beach.jpg'), new File(['b'], 'broken.heic'), new File(['c'], 'park.png')])

    expect(photos.prepareImage).toHaveBeenCalledTimes(3)
    expect(settingsApi.uploadPhoto).toHaveBeenCalledTimes(2)
    expect(settingsApi.uploadPhoto).toHaveBeenNthCalledWith(1, HOUSEHOLD, expect.any(Blob))
    expect(await (settingsApi.uploadPhoto.mock.calls[0]![1] as Blob).text()).toBe('prepared beach.jpg')
    expect(settingsApi.addPhoto.mock.calls).toEqual([
      [SAM_AUTH, 'eeeeeeee-0000-0000-0000-000000000001', 'slideshow'],
      [SAM_AUTH, 'eeeeeeee-0000-0000-0000-000000000002', 'slideshow'],
    ])
    const rows = w.findAll('[data-testid="photo-upload"]').map((r) => r.text())
    expect(rows).toEqual([
      expect.stringMatching(/beach\.jpg.*Added/),
      expect.stringMatching(/broken\.heic.*Couldn’t read this file as a photo\. Skipped\./),
      expect.stringMatching(/park\.png.*Added/),
    ])
    w.unmount()
  })

  it('holds app-update reloads while photos are being added (spec §5.8)', async () => {
    let finishUpload: (id: string) => void = () => {}
    settingsApi.uploadPhoto.mockImplementationOnce(() => new Promise<string>((resolve) => (finishUpload = resolve)))
    const w = await mountSection([])
    expect(hasReloadHold('photoUpload')).toBe(false)
    await chooseFiles(w, [new File(['a'], 'one.jpg')])
    expect(hasReloadHold('photoUpload')).toBe(true)
    finishUpload('eeeeeeee-0000-0000-0000-000000000009')
    await settle()
    expect(hasReloadHold('photoUpload')).toBe(false)
    w.unmount()
    clearReloadHolds()
  })

  it('stops at 200 slideshow photos', async () => {
    const list = Array.from({ length: 199 }, (_, i) => photo(i + 1))
    const w = await mountSection(list)
    expect(w.text()).toContain('199 of 200')
    await chooseFiles(w, [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')])
    expect(settingsApi.addPhoto).toHaveBeenCalledTimes(1)
    expect(w.findAll('[data-testid="photo-upload"]')[1]!.text()).toContain('Skipped: the slideshow holds up to 200 photos.')

    setPhotos([...list, photo(500)])
    await settle()
    expect(w.text()).toContain('200 of 200')
    expect(buttonByText(w, 'Add photos').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('shows the server’s message and stops when adding fails', async () => {
    settingsApi.addPhoto.mockRejectedValueOnce(new SettingsError('Your connection dropped', 'network'))
    const w = await mountSection([])
    await chooseFiles(w, [new File(['a'], 'one.jpg'), new File(['b'], 'two.jpg')])
    const rows = w.findAll('[data-testid="photo-upload"]').map((r) => r.text())
    expect(rows[0]).toContain('Couldn’t reach Roost Family')
    expect(rows[1]).toContain('Not added')
    expect(settingsApi.uploadPhoto).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('deletes a photo after confirming', async () => {
    const w = await mountSection([photo(1), photo(2)])
    await w.get('button[aria-label="Delete photo 1"]').trigger('click')
    await settle()
    expect(w.text()).toContain('Delete this photo? It’s removed from every display.')
    await buttonByText(w, 'Delete').trigger('click')
    await settle()
    expect(settingsApi.deletePhoto).toHaveBeenCalledWith(SAM_AUTH, photo(2).id)
    w.unmount()
  })

  it('offline: Add photos is disabled', async () => {
    setOnline(false)
    const w = await mountSection([photo(1)])
    expect(buttonByText(w, 'Add photos').attributes('disabled')).toBeDefined()
    w.unmount()
  })
})
