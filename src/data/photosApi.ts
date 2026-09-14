/**
 * Household photos (spec §7.7, §7.9, §11.1). Photos are prepared on the device — decoded, scaled to at most 1600 px
 * on the long edge and re-encoded as JPEG, which drops EXIF/GPS and every other piece of metadata — then uploaded to
 * the private `household-photos` bucket at `<household_id>/<photo_id>.jpg` and shown only through short-lived signed
 * URLs. Uploading and the PIN-checked add/delete live on `SettingsApi`; this module holds what both Settings and
 * Night Mode need.
 */
import { isDemo } from './householdSource'
import type { RoostClient } from './supabase'

export const PHOTO_BUCKET = 'household-photos'
export const MAX_SLIDESHOW_PHOTOS = 200
export const PHOTO_MAX_EDGE = 1600
export const PHOTO_JPEG_QUALITY = 0.85
/** Signed URL lifetime; viewers refresh them before they expire. */
export const PHOTO_URL_SECONDS = 3600

export function photoPath(householdId: string, photoId: string): string {
  return `${householdId}/${photoId}.jpg`
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

/**
 * Decodes `file` (applying its EXIF orientation), draws it onto a canvas at most 1600 px on the long edge and
 * re-encodes it as JPEG q0.85. Only pixels survive the canvas, so the result carries no location or other metadata.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoDecodeError()
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoDecodeError('This device could not prepare the photo')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY))
    if (!blob) throw new PhotoDecodeError('This device could not prepare the photo')
    return blob
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
