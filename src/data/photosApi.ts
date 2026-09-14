/**
 * Household photos (spec §7.7, §7.9, §11.1). Photos are prepared on the device — decoded, scaled to at most 1600 px
 * on the long edge and re-encoded as JPEG, which drops EXIF/GPS and every other piece of metadata — then uploaded to
 * the private `household-photos` bucket at `<household_id>/<photo_id>.jpg` and shown only through short-lived signed
 * URLs. A ~320 px thumbnail, `<household_id>/<photo_id>.thumb.jpg`, is uploaded next to it for Settings' grid (Storage
 * image transforms can be off, and 200 full-size decodes are heavy for a tablet); it isn't a `photos` row, is readable
 * exactly while its photo is, and is erased with it. Uploading and the PIN-checked add/delete live on `SettingsApi`;
 * this module holds what both Settings and Night Mode need.
 */
import { isDemo } from './householdSource'
import type { RoostClient } from './supabase'

export const PHOTO_BUCKET = 'household-photos'
export const MAX_SLIDESHOW_PHOTOS = 200
export const PHOTO_MAX_EDGE = 1600
export const PHOTO_JPEG_QUALITY = 0.85
export const PHOTO_THUMB_EDGE = 320
export const PHOTO_THUMB_QUALITY = 0.8
/** Signed URL lifetime (spec §11.1: short-lived); viewers re-sign 5 minutes before they expire. */
export const PHOTO_URL_SECONDS = 15 * 60
/** Stored with each upload and sent with every read: browsers may keep a photo for 5 minutes, shared caches never. */
export const PHOTO_CACHE_CONTROL = 'private, max-age=300'

export function photoPath(householdId: string, photoId: string): string {
  return `${householdId}/${photoId}.jpg`
}

/** A stored photo's thumbnail path (`<household>/<photo>.thumb.jpg`); any other path (the demo's URLs) as it is. */
export function thumbnailPath(storagePath: string): string {
  return storagePath.endsWith('.jpg') ? `${storagePath.slice(0, -'.jpg'.length)}.thumb.jpg` : storagePath
}

/** A photo ready to upload: the resized JPEG and its thumbnail. */
export interface PreparedPhoto {
  image: Blob
  thumbnail: Blob
}

/** The size to draw a `width`×`height` image so its long edge is at most `maxEdge` (never enlarged). */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The file isn't an image this browser can decode (or re-encode). */
export class PhotoDecodeError extends Error {
  constructor(message = 'This file could not be read as a photo') {
    super(message)
    this.name = 'PhotoDecodeError'
  }
}

function encodeJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new PhotoDecodeError('This device could not prepare the photo')
  context.drawImage(bitmap, 0, 0, width, height)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoDecodeError('This device could not prepare the photo'))), 'image/jpeg', quality),
  )
}

/**
 * Decodes `file` (applying its EXIF orientation), draws it onto a canvas at most 1600 px on the long edge and
 * re-encodes it as JPEG q0.85, and the same pixels at most 320 px as the thumbnail. Only pixels survive the canvas,
 * so neither carries location or other metadata.
 */
export async function prepareImage(file: Blob): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoDecodeError()
  }
  try {
    const image = await encodeJpeg(bitmap, PHOTO_MAX_EDGE, PHOTO_JPEG_QUALITY)
    const thumbnail = await encodeJpeg(bitmap, PHOTO_THUMB_EDGE, PHOTO_THUMB_QUALITY)
    return { image, thumbnail }
  } finally {
    bitmap.close()
  }
}

export interface PhotoUrlApi {
  /** Signed URLs for `paths` (one request), valid for `expiresInSeconds`. Paths that can't be signed (deleted,
   *  or not this household's) are left out of the map. */
  signedUrls(paths: string[], expiresInSeconds: number): Promise<Map<string, string>>
}

export function createPhotoUrlApi(client: RoostClient): PhotoUrlApi {
  return {
    async signedUrls(paths, expiresInSeconds) {
      const urls = new Map<string, string>()
      if (paths.length === 0) return urls
      const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(paths, expiresInSeconds)
      if (error) throw error
      for (const entry of data) {
        if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl)
      }
      return urls
    },
  }
}

/** The demo's photos are stored as data: or blob: URLs in place of storage paths; they need no signing. */
export const demoPhotoUrlApi: PhotoUrlApi = {
  async signedUrls(paths) {
    return new Map(paths.filter((p) => p.startsWith('data:') || p.startsWith('blob:')).map((p) => [p, p]))
  },
}

/** This device's URL signer, on the display's own client (loaded lazily so tests never build a Supabase client). */
export async function loadPhotoUrlApi(): Promise<PhotoUrlApi> {
  if (isDemo) return demoPhotoUrlApi
  const { displayClient } = await import('./supabase')
  return createPhotoUrlApi(displayClient)
}
