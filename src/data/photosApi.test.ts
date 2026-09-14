import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoostClient } from './supabase'
import {
  PHOTO_BUCKET,
  PHOTO_CACHE_CONTROL,
  PHOTO_URL_SECONDS,
  PhotoDecodeError,
  createPhotoUrlApi,
  demoPhotoUrlApi,
  fitWithin,
  photoPath,
  prepareImage,
  thumbnailPath,
} from './photosApi'

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const PHOTO = 'dddddddd-0000-0000-0000-000000000001'

describe('photoPath', () => {
  it('is <household>/<photo>.jpg', () => {
    expect(photoPath(HOUSEHOLD, PHOTO)).toBe(`${HOUSEHOLD}/${PHOTO}.jpg`)
  })
})

describe('thumbnailPath', () => {
  it('is <household>/<photo>.thumb.jpg next to the photo', () => {
    expect(thumbnailPath(`${HOUSEHOLD}/${PHOTO}.jpg`)).toBe(`${HOUSEHOLD}/${PHOTO}.thumb.jpg`)
  })

  it('leaves a path that is not a stored JPEG (the demo\'s data: and blob: URLs) as it is', () => {
    expect(thumbnailPath('data:image/svg+xml,<svg/>')).toBe('data:image/svg+xml,<svg/>')
    expect(thumbnailPath('blob:http://localhost/1')).toBe('blob:http://localhost/1')
  })
})

describe('photo lifetimes', () => {
  it('signs URLs for 15 minutes and asks caches to keep a photo privately for at most 5', () => {
    expect(PHOTO_URL_SECONDS).toBe(15 * 60)
    expect(PHOTO_CACHE_CONTROL).toBe('private, max-age=300')
  })
})

describe('fitWithin', () => {
  it('scales the long edge down to the limit, keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('never scales up, and never returns a zero dimension', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10000, 2, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('prepareImage', () => {
  const drawImage = vi.fn()
  let encodes: { type?: string; quality: unknown; width: number; height: number }[] = []
  const close = vi.fn()

  beforeEach(() => {
    encodes = []
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { drawImage } as unknown as CanvasRenderingContext2D
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: unknown,
    ) {
      encodes.push({ type, quality, width: this.width, height: this.height })
      callback(new Blob([`jpeg-${this.width}`], { type: 'image/jpeg' }))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    drawImage.mockReset()
    close.mockReset()
  })

  it('decodes with EXIF orientation applied, redraws at most 1600 px and re-encodes as JPEG 0.85 (dropping metadata)', async () => {
    const file = new File(['original-with-exif'], 'IMG_0001.HEIC', { type: 'image/heic' })
    const { image } = await prepareImage(file)

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
    expect(encodes[0]).toEqual({ type: 'image/jpeg', quality: 0.85, width: 1600, height: 1200 })
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 4032 }), 0, 0, 1600, 1200)
    expect(image.type).toBe('image/jpeg')
    // The output is the canvas's own encoding, never the original file's bytes (which carry the metadata).
    expect(image).not.toBe(file)
    expect(await image.text()).toBe('jpeg-1600')
    expect(close).toHaveBeenCalled()
  })

  it('also encodes a JPEG thumbnail at most 320 px on the long edge, from the same decoded pixels', async () => {
    const { thumbnail } = await prepareImage(new File(['x'], 'IMG_0002.jpg', { type: 'image/jpeg' }))
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(encodes[1]).toEqual({ type: 'image/jpeg', quality: 0.8, width: 320, height: 240 })
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 4032 }), 0, 0, 320, 240)
    expect(await thumbnail.text()).toBe('jpeg-320')
  })

  it('throws PhotoDecodeError for a file the browser cannot decode', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError')
    }))
    await expect(prepareImage(new File(['nope'], 'notes.txt'))).rejects.toBeInstanceOf(PhotoDecodeError)
  })

  it('throws PhotoDecodeError when the canvas produces no image', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(null))
    await expect(prepareImage(new File(['x'], 'a.jpg'))).rejects.toBeInstanceOf(PhotoDecodeError)
    expect(close).toHaveBeenCalled()
  })
})

describe('createPhotoUrlApi', () => {
  function fakeClient(result: unknown) {
    const createSignedUrls = vi.fn(async () => result)
    const from = vi.fn(() => ({ createSignedUrls }))
    return { client: { storage: { from } } as unknown as RoostClient, from, createSignedUrls }
  }

  it('signs every path in one batch and maps path -> URL, skipping per-path failures', async () => {
    const a = `${HOUSEHOLD}/a.jpg`
    const b = `${HOUSEHOLD}/b.jpg`
    const { client, from, createSignedUrls } = fakeClient({
      data: [
        { path: a, signedUrl: 'https://x/sign/a?token=1', error: null },
        { path: b, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' },
      ],
      error: null,
    })
    const urls = await createPhotoUrlApi(client).signedUrls([a, b], 3600)
    expect(from).toHaveBeenCalledWith(PHOTO_BUCKET)
    expect(createSignedUrls).toHaveBeenCalledWith([a, b], 3600)
    expect([...urls]).toEqual([[a, 'https://x/sign/a?token=1']])
  })

  it('does not call the server for no paths', async () => {
    const { client, createSignedUrls } = fakeClient({ data: [], error: null })
    expect((await createPhotoUrlApi(client).signedUrls([], 3600)).size).toBe(0)
    expect(createSignedUrls).not.toHaveBeenCalled()
  })

  it('rejects when the batch fails', async () => {
    const { client } = fakeClient({ data: null, error: new Error('Failed to fetch') })
    await expect(createPhotoUrlApi(client).signedUrls(['x'], 3600)).rejects.toThrow('Failed to fetch')
  })
})

describe('demoPhotoUrlApi', () => {
  it('passes the demo photos’ data and blob URLs straight through', async () => {
    const urls = await demoPhotoUrlApi.signedUrls(['data:image/svg+xml,<svg/>', 'blob:http://localhost/1', 'h/x.jpg'], 3600)
    expect([...urls]).toEqual([
      ['data:image/svg+xml,<svg/>', 'data:image/svg+xml,<svg/>'],
      ['blob:http://localhost/1', 'blob:http://localhost/1'],
    ])
  })
})
