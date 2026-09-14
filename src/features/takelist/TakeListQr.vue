<script setup lang="ts">
/**
 * Take list QR sheet (spec §7.8), opened from the Grocery sheet. Each opening creates a fresh 24-hour link (which
 * revokes any earlier one) and shows it as a QR code. "Done" closes and leaves the link working; "Done shopping —
 * end link" revokes it. Needs a connection: offline it asks for one and creates the link once back online.
 */
import { computed, ref, watch } from 'vue'
import { TakeListError, loadTakeListDisplayApi, takeListUrl, type TakeListDisplayApi } from '@/data/takeListApi'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RSheet from '@/ui/RSheet.vue'

const props = defineProps<{ open: boolean; api?: TakeListDisplayApi }>()
const emit = defineEmits<{ close: [] }>()

type State = 'idle' | 'creating' | 'ready' | 'offline' | 'error'

const householdStore = useHouseholdStore()
const householdId = computed(() => householdStore.view?.household.id ?? null)

const state = ref<State>('idle')
const url = ref<string | null>(null)
const svg = ref<string | null>(null)
const endError = ref<string | null>(null)
const ending = ref(false)
/** Bumped on every open and close, so a link that arrives after the sheet closed (or reopened) is dropped. */
let generation = 0

let api: TakeListDisplayApi | null = props.api ?? null
async function getApi(): Promise<TakeListDisplayApi> {
  api ??= await loadTakeListDisplayApi()
  return api
}

async function create(): Promise<void> {
  const current = ++generation
  url.value = null
  svg.value = null
  endError.value = null
  if (!householdStore.online || householdId.value === null) {
    state.value = 'offline'
    return
  }
  state.value = 'creating'
  try {
    const link = await (await getApi()).createLink(householdId.value)
    const linkUrl = takeListUrl(window.location.origin, link.token)
    // The SVG is generated locally from our own URL (never user input), so it is safe to insert as HTML.
    const { default: QRCode } = await import('qrcode')
    const markup = await QRCode.toString(linkUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    if (current !== generation) return
    url.value = linkUrl
    svg.value = markup
    state.value = 'ready'
  } catch (e) {
    if (current !== generation) return
    state.value = e instanceof TakeListError && e.code === 'network' ? 'offline' : 'error'
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void create()
    } else {
      generation++
      state.value = 'idle'
      url.value = null
      svg.value = null
    }
  },
  { immediate: true },
)

watch(
  () => householdStore.online,
  (online) => {
    if (online && props.open && state.value === 'offline') void create()
  },
)

async function endLink(): Promise<void> {
  if (householdId.value === null || ending.value) return
  ending.value = true
  endError.value = null
  try {
    await (await getApi()).revoke(householdId.value)
    emit('close')
  } catch {
    endError.value = "Couldn't end the link. Check the connection and try again."
  } finally {
    ending.value = false
  }
}
</script>

<template>
  <RSheet title="Take the list with you" :open="open" @close="emit('close')">
    <div class="grid grid-cols-1 items-center gap-8 md:grid-cols-[1fr_auto]">
      <div class="flex flex-col gap-4">
        <p class="text-[24px] font-medium text-ink">Scan with your phone's camera</p>
        <p class="text-[20px] leading-snug text-ink-2">
          The page shows groceries only and lets you check items off while you shop.
        </p>
        <p class="flex items-center gap-2 text-[18px] text-ink-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          Expires in 24 hours
        </p>
        <p v-if="endError" role="alert" class="rounded-[14px] bg-orange-tint px-4 py-3 text-[18px] text-warn-ink">{{ endError }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <RButton tier="moment" @click="emit('close')">Done</RButton>
          <RButton v-if="state === 'ready'" variant="secondary" :disabled="ending" @click="endLink">Done shopping — end link</RButton>
        </div>
      </div>

      <div class="flex size-[352px] items-center justify-center justify-self-center rounded-[var(--radius-card)] bg-white p-4">
        <div
          v-if="state === 'ready' && svg"
          data-testid="take-list-qr"
          role="img"
          aria-label="QR code for the grocery list link"
          :data-url="url"
          class="size-full [&>svg]:size-full"
          v-html="svg"
        />
        <p v-else-if="state === 'offline'" class="px-4 text-center text-[20px] text-ink-2">Connect to share the list.</p>
        <div v-else-if="state === 'error'" class="flex flex-col items-center gap-4 px-4 text-center">
          <p role="alert" class="text-[20px] text-warn-ink">Couldn't make a link.</p>
          <RButton variant="secondary" @click="create">Try again</RButton>
        </div>
        <p v-else role="status" class="text-[20px] text-ink-3">Making a link…</p>
      </div>
    </div>
  </RSheet>
</template>
