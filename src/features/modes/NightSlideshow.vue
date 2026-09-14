<script setup lang="ts">
/**
 * The Night Mode photo slideshow (spec §7.7): one household photo a minute, crossfading over 1.5 s (an instant swap
 * with Reduce Motion), in a shuffled order that stays the same all night, under a dark scrim that keeps the clock
 * readable. Photos are shown through signed URLs, refreshed 5 minutes before they expire. Each photo is preloaded
 * before its minute; a photo that can't load (offline, deleted) is skipped, so offline the slideshow keeps cycling
 * the photos it already has, and with none it shows nothing (the clock alone). Emits `showing` as that changes.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { loadPhotoUrlApi, PHOTO_URL_SECONDS, type PhotoUrlApi } from '@/data/photosApi'
import type { HouseholdPhoto } from '@/data/snapshot'
import { NIGHT_PHOTO_SCRIM } from './nightColors'
import {
  CROSSFADE_MS, nextShown, nightSeed, shuffledOrder, SLIDE_MS, slotAt, URL_REFRESH_MARGIN_MS, URL_RETRY_MS,
} from './slideshow'

const props = defineProps<{ photos: HouseholdPhoto[]; timeZone: string }>()
const emit = defineEmits<{ showing: [boolean] }>()

/** Storage path -> the latest signed URL. */
const signedUrls = new Map<string, string>()
/** Photo id -> the URL its image loaded from (kept when a later URL fails, so offline it can still be shown). */
const loaded = reactive(new Map<string, string>())
/** URLs that failed to load; not retried until they are re-signed. */
const failedUrls = new Set<string>()
/** URLs being loaded right now. */
const inFlight = new Set<string>()
const activeId = ref<string | null>(null)
const leaving = ref<{ id: string; url: string } | null>(null)
const reducedMotion = ref(false)

const photoById = computed(() => new Map(props.photos.map((p) => [p.id, p])))
const order = computed(() => shuffledOrder(props.photos.map((p) => p.id), nightSeed(new Date(), props.timeZone)))

const slides = computed(() => {
  const list: { id: string; url: string; active: boolean }[] = []
  const active = activeId.value
  const activeUrl = active === null ? undefined : loaded.get(active)
  if (active !== null && activeUrl !== undefined) list.push({ id: active, url: activeUrl, active: true })
  if (leaving.value && leaving.value.id !== active) list.push({ ...leaving.value, active: false })
  return list
})

let api: PhotoUrlApi | null = null
let disposed = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let tickTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined

function wanted(): string | null {
  return nextShown(order.value, slotAt(Date.now()), new Set(loaded.keys()))
}

function show(id: string | null): void {
  if (id === activeId.value) return
  const previous = activeId.value
  const previousUrl = previous === null ? undefined : loaded.get(previous)
  activeId.value = id
  clearTimeout(leaveTimer)
  if (previous !== null && previousUrl !== undefined && id !== null && !reducedMotion.value) {
    leaving.value = { id: previous, url: previousUrl }
    leaveTimer = setTimeout(() => (leaving.value = null), CROSSFADE_MS)
  } else {
    leaving.value = null
  }
}

function preload(id: string, onFail?: () => void): void {
  const photo = photoById.value.get(id)
  const url = photo && signedUrls.get(photo.storagePath)
  if (!url || loaded.get(id) === url || inFlight.has(url)) return
  if (failedUrls.has(url)) {
    onFail?.()
    return
  }
  inFlight.add(url)
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    inFlight.delete(url)
    if (disposed || !photoById.value.has(id)) return
    loaded.set(id, url)
    // Shows it now if nothing is on screen yet, or if it is this minute's photo and arrived late.
    const want = wanted()
    if (activeId.value === null || want === id) show(want)
  }
  image.onerror = () => {
    inFlight.delete(url)
    if (disposed) return
    failedUrls.add(url)
    onFail?.()
  }
  image.src = url
}

/** Preloads this minute's photo and the next one. While nothing is on screen, a photo that fails hands on to the
 *  one after it, so one broken photo doesn't leave the screen empty. */
function preloadAround(): void {
  const ids = order.value
  const n = ids.length
  if (n === 0) return
  const start = slotAt(Date.now()) % n
  const attempt = (k: number): void => {
    if (k >= n) return
    preload(ids[(start + k) % n]!, () => {
      if (activeId.value === null) attempt(k + 1)
    })
  }
  attempt(0)
  if (n > 1) preload(ids[(start + 1) % n]!)
}

async function refreshUrls(): Promise<void> {
  clearTimeout(refreshTimer)
  const paths = props.photos.map((p) => p.storagePath)
  if (paths.length === 0) return
  try {
    api ??= await loadPhotoUrlApi()
    const fresh = await api.signedUrls(paths, PHOTO_URL_SECONDS)
    if (disposed) return
    signedUrls.clear()
    for (const [path, url] of fresh) signedUrls.set(path, url)
    failedUrls.clear()
    refreshTimer = setTimeout(() => void refreshUrls(), PHOTO_URL_SECONDS * 1000 - URL_REFRESH_MARGIN_MS)
    preloadAround()
  } catch {
    if (disposed) return
    refreshTimer = setTimeout(() => void refreshUrls(), URL_RETRY_MS)
  }
}

function scheduleTick(): void {
  tickTimer = setTimeout(() => {
    show(wanted() ?? activeId.value)
    preloadAround()
    scheduleTick()
  }, SLIDE_MS - (Date.now() % SLIDE_MS))
}

// Photos added or deleted (Settings, or another display): forget deleted ones and sign new ones.
watch(
  () => props.photos.map((p) => `${p.id}:${p.storagePath}`).join('|'),
  () => {
    for (const id of [...loaded.keys()]) if (!photoById.value.has(id)) loaded.delete(id)
    if (leaving.value && !photoById.value.has(leaving.value.id)) leaving.value = null
    if (activeId.value !== null && !photoById.value.has(activeId.value)) {
      activeId.value = null
      show(wanted())
    }
    if (props.photos.some((p) => !signedUrls.has(p.storagePath))) void refreshUrls()
    else preloadAround()
  },
)

watch(
  () => slides.value.length > 0,
  (showing) => emit('showing', showing),
  { immediate: true },
)

onMounted(() => {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  void refreshUrls()
  scheduleTick()
})

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(refreshTimer)
  clearTimeout(tickTimer)
  clearTimeout(leaveTimer)
})
</script>

<template>
  <div v-if="slides.length > 0" class="absolute inset-0" aria-hidden="true">
    <img
      v-for="slide in slides"
      :key="slide.id"
      data-testid="night-slide"
      :data-photo-id="slide.id"
      :data-active="slide.active"
      :src="slide.url"
      alt=""
      class="absolute inset-0 h-full w-full object-contain"
      :style="{
        opacity: slide.active ? 1 : 0,
        zIndex: slide.active ? 0 : 1,
        transition: reducedMotion ? 'none' : `opacity ${CROSSFADE_MS}ms ease-in-out`,
      }"
    />
    <div data-testid="night-scrim" class="absolute inset-0 z-[2]" :style="{ background: NIGHT_PHOTO_SCRIM }" />
  </div>
</template>
