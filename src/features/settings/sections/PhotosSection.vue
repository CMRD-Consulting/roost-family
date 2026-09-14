<script setup lang="ts">
/**
 * Settings > Photos (spec §7.7, §7.9, §11.1): the household's Night Mode slideshow photos, up to 200. Chosen files
 * are prepared on this tablet (resized to 1600 px, re-encoded so location and other metadata are dropped), uploaded
 * one at a time, with a 320 px thumbnail, to the household's private storage and added with the settings session's PIN.
 * The grid shows the thumbnails (a photo added before thumbnails existed shows itself) through 15-minute signed URLs,
 * re-signed 5 minutes before they expire.
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useReloadHold } from '@/app/reloadHolds'
import {
  loadPhotoUrlApi, MAX_SLIDESHOW_PHOTOS, PHOTO_THUMB_EDGE, PHOTO_URL_SECONDS, PhotoDecodeError, prepareImage, thumbnailPath,
} from '@/data/photosApi'
import { SettingsError } from '@/data/settingsApi'
import type { HouseholdPhoto } from '@/data/snapshot'
import { useHouseholdStore } from '@/stores/householdStore'
import { useSettingsSessionStore } from '@/stores/settingsSession'
import RButton from '@/ui/RButton.vue'
import { URL_REFRESH_MARGIN_MS } from '@/features/modes/slideshow'
import { loadSettingsApi } from '../settingsApiLoader'
import { settingsErrorMessage } from '../settingsErrors'
import { useSettingsOffline, useSettingsSave } from '../useSettingsSave'

const store = useHouseholdStore()
const session = useSettingsSessionStore()
const offline = useSettingsOffline()

/** Slideshow photos, newest first. */
const photos = computed<HouseholdPhoto[]>(() =>
  (store.view?.photos ?? []).filter((p) => p.kind === 'slideshow').sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
)
const atLimit = computed(() => photos.value.length >= MAX_SLIDESHOW_PHOTOS)

// ─── Thumbnails ────────────────────────────────────────────────────────────
/** Storage path -> signed URL of its thumbnail, or of the photo itself when it has no thumbnail. */
const thumbUrls = reactive(new Map<string, string>())
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

/** Signs thumbnails for `paths`, then the photos themselves for any thumbnail that couldn't be signed. */
async function signTiles(paths: string[]): Promise<Map<string, string>> {
  const api = await loadPhotoUrlApi()
  const thumbs = await api.signedUrls(paths.map(thumbnailPath), PHOTO_URL_SECONDS)
  const withoutThumb = paths.filter((path) => !thumbs.has(thumbnailPath(path)))
  const originals = withoutThumb.length > 0 ? await api.signedUrls(withoutThumb, PHOTO_URL_SECONDS) : new Map<string, string>()
  const urls = new Map<string, string>()
  for (const path of paths) {
    const url = thumbs.get(thumbnailPath(path)) ?? originals.get(path)
    if (url !== undefined) urls.set(path, url)
  }
  return urls
}

/** Re-signs every tile 5 minutes before the URLs expire, so a lazy image scrolled into view later still loads. */
function scheduleRefresh(): void {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    try {
      const urls = await signTiles(photos.value.map((p) => p.storagePath))
      if (disposed) return
      thumbUrls.clear()
      for (const [path, url] of urls) thumbUrls.set(path, url)
    } catch {
      // Offline: the tiles keep their URLs; the next round tries again.
    }
    if (!disposed) scheduleRefresh()
  }, PHOTO_URL_SECONDS * 1000 - URL_REFRESH_MARGIN_MS)
}

watch(
  () => photos.value.map((p) => p.storagePath).join('|'),
  async () => {
    const missing = photos.value.map((p) => p.storagePath).filter((path) => !thumbUrls.has(path))
    if (missing.length === 0) return
    try {
      const urls = await signTiles(missing)
      if (disposed) return
      for (const [path, url] of urls) thumbUrls.set(path, url)
      if (refreshTimer === undefined) scheduleRefresh()
    } catch {
      // Offline or signing failed: the tiles stay blank; the next change retries.
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(refreshTimer)
})

// ─── Adding ────────────────────────────────────────────────────────────────
type UploadState = 'waiting' | 'preparing' | 'uploading' | 'added' | 'skipped' | 'failed'
interface Upload {
  key: number
  name: string
  state: UploadState
  message: string
}

const STATE_TEXT: Record<UploadState, string> = {
  waiting: 'Waiting…',
  preparing: 'Preparing…',
  uploading: 'Uploading…',
  added: 'Added',
  skipped: 'Skipped.',
  failed: 'Not added.',
}

const fileInput = ref<HTMLInputElement | null>(null)
const uploads = ref<Upload[]>([])
const adding = ref(false)
let nextKey = 0
// No app update reloads the tablet while photos are being added (spec §5.8).
useReloadHold('photoUpload', () => adding.value)

function chooseFiles(): void {
  fileInput.value?.click()
}

async function onFilesChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length === 0 || adding.value || offline.value) return
  const auth = session.auth
  const householdId = store.view?.household.id
  if (auth === null || !householdId) return

  uploads.value = files.map((file) => ({ key: nextKey++, name: file.name, state: 'waiting', message: '' }))
  adding.value = true
  let count = photos.value.length
  let stopped = false
  try {
    const api = await loadSettingsApi()
    for (const [i, file] of files.entries()) {
      const row = uploads.value[i]!
      if (stopped) {
        row.state = 'failed'
        continue
      }
      if (count >= MAX_SLIDESHOW_PHOTOS) {
        row.state = 'skipped'
        row.message = `Skipped: the slideshow holds up to ${MAX_SLIDESHOW_PHOTOS} photos.`
        continue
      }
      try {
        row.state = 'preparing'
        const image = await prepareImage(file)
        row.state = 'uploading'
        const photoId = await api.uploadPhoto(householdId, image)
        await api.addPhoto(auth, photoId, 'slideshow')
        row.state = 'added'
        count++
      } catch (e) {
        if (e instanceof PhotoDecodeError) {
          row.state = 'skipped'
          row.message = 'Couldn’t read this file as a photo. Skipped.'
          continue
        }
        row.state = 'failed'
        row.message = settingsErrorMessage(e)
        // A wrong PIN, lost connection or full slideshow will fail the rest the same way.
        if (!(e instanceof SettingsError) || e.code !== 'other') stopped = true
      }
    }
  } finally {
    adding.value = false
    void store.reload()
  }
}

function uploadText(upload: Upload): string {
  return upload.message || STATE_TEXT[upload.state]
}

// ─── Deleting ──────────────────────────────────────────────────────────────
const confirmingId = ref<string | null>(null)
const { saving: deleting, error: deleteError, save: saveDelete } = useSettingsSave()

async function confirmDelete(photoId: string): Promise<void> {
  const ok = await saveDelete((api, auth) => api.deletePhoto(auth, photoId))
  if (ok) {
    confirmingId.value = null
    void store.reload()
  }
}
</script>

<template>
  <section aria-labelledby="settings-photos-title" class="flex flex-col gap-5">
    <h2 id="settings-photos-title" class="text-[32px] font-semibold text-ink">Photos</h2>

    <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <div class="flex items-center justify-between gap-4">
        <p class="text-[20px] font-medium text-ink">
          Slideshow photos · <span data-testid="photo-count">{{ photos.length }} of {{ MAX_SLIDESHOW_PHOTOS }}</span>
        </p>
        <RButton variant="primary" :disabled="offline || adding || atLimit" @click="chooseFiles">Add photos</RButton>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          aria-label="Choose photos to add"
          @change="onFilesChosen"
        />
      </div>

      <ul v-if="uploads.length > 0" aria-label="Adding photos" aria-live="polite" class="flex flex-col gap-1">
        <li
          v-for="upload in uploads"
          :key="upload.key"
          data-testid="photo-upload"
          class="flex items-center justify-between gap-4 border-b border-line py-2 text-[18px] last:border-b-0"
        >
          <span class="min-w-0 truncate text-ink">{{ upload.name }}</span>
          <span
            class="shrink-0"
            :class="upload.state === 'failed' || upload.state === 'skipped' ? 'text-warn-ink' : 'text-ink-2'"
          >
            {{ uploadText(upload) }}
          </span>
        </li>
      </ul>

      <ul v-if="photos.length > 0" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <li v-for="(photo, i) in photos" :key="photo.id" data-testid="photo-thumb" class="flex flex-col gap-2">
          <div class="relative aspect-square overflow-hidden rounded-[12px] bg-surface-2">
            <img
              v-if="thumbUrls.get(photo.storagePath)"
              :src="thumbUrls.get(photo.storagePath)"
              alt=""
              loading="lazy"
              decoding="async"
              :width="PHOTO_THUMB_EDGE"
              :height="PHOTO_THUMB_EDGE"
              class="h-full w-full object-cover"
            />
            <button
              v-if="confirmingId !== photo.id"
              type="button"
              :aria-label="`Delete photo ${i + 1}`"
              class="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full bg-ink/70 text-[22px] leading-none text-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              @click="confirmingId = photo.id"
            >
              ×
            </button>
          </div>
          <div v-if="confirmingId === photo.id" class="flex flex-col gap-2">
            <p class="text-[18px] text-ink">Delete this photo? It’s removed from every display.</p>
            <div class="flex flex-wrap gap-2">
              <RButton variant="secondary" :disabled="deleting" @click="confirmingId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="deleting || offline" @click="confirmDelete(photo.id)">Delete</RButton>
            </div>
            <p v-if="deleteError" role="alert" class="text-[18px] text-warn-ink">{{ deleteError }}</p>
          </div>
        </li>
      </ul>
      <p v-else class="text-[18px] text-ink-3">No photos yet. Night Mode shows the clock alone until you add some.</p>

      <p class="text-[18px] text-ink-3">In Night Mode, one photo shows every 60 seconds behind a dark overlay.</p>
    </div>

    <p class="text-[18px] text-ink-3">
      Photos are resized and location data is removed before upload. Up to {{ MAX_SLIDESHOW_PHOTOS }} photos, stored
      privately for this household.
    </p>
  </section>
</template>
