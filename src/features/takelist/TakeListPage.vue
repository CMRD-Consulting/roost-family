<script setup lang="ts">
/**
 * Take list phone page (spec §7.8, §13) at /list/:token. Opened from the display's QR code on any phone, so it
 * uses nothing of the display: no display session, no household store, only the token and a session-less anon
 * client. Groceries only; items can be checked off but not added or deleted. Check-offs show at once and are
 * sent in the background; one made without a connection is kept and sent on the next poll. Polls every 10 s
 * while the page is visible.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { TakeListError, loadTakeListPageApi, type TakeListItem, type TakeListPageApi } from '@/data/takeListApi'
import RLogo from '@/ui/RLogo.vue'

const props = defineProps<{ token: string; api?: TakeListPageApi }>()

const POLL_MS = 10_000

type Phase = 'loading' | 'list' | 'expired' | 'done'

const phase = ref<Phase>('loading')
const serverItems = ref<TakeListItem[]>([])
/** Check-offs not yet confirmed by the server: item id → checked. They override the server's value. */
const pending = reactive(new Map<string, boolean>())
const offline = ref(false)
const finishing = ref(false)
/** Counts check-offs, so a list fetched while one was made (and may predate it) is not applied. */
let toggles = 0

const items = computed(() => {
  const merged = serverItems.value.map((i) => (pending.has(i.id) ? { ...i, checked: pending.get(i.id)! } : i))
  return [...merged.filter((i) => !i.checked), ...merged.filter((i) => i.checked)]
})

const ended = () => phase.value === 'expired' || phase.value === 'done'

let api: TakeListPageApi | null = props.api ?? null
async function getApi(): Promise<TakeListPageApi> {
  api ??= await loadTakeListPageApi()
  return api
}

/** Applies a failed call: an ended link shows the expired state; anything else is treated as no connection. */
function fail(e: unknown): void {
  if (e instanceof TakeListError && e.code === 'denied') {
    phase.value = 'expired'
    stopPolling()
    return
  }
  offline.value = true
}

let flushing: Promise<void> | null = null
function flush(): Promise<void> {
  flushing ??= sendPending().finally(() => (flushing = null))
  return flushing
}

async function sendPending(): Promise<void> {
  const client = await getApi()
  while (pending.size > 0 && !ended()) {
    const [id, checked] = pending.entries().next().value as [string, boolean]
    try {
      await client.setChecked(props.token, id, checked)
    } catch (e) {
      // The item was deleted at home: drop the check-off; the next refresh removes the row.
      if (e instanceof TakeListError && e.code === 'invalid') {
        pending.delete(id)
        continue
      }
      fail(e)
      return
    }
    offline.value = false
    serverItems.value = serverItems.value.map((i) => (i.id === id ? { ...i, checked } : i))
    // Toggled again while the request was out: loop and send the newer value.
    if (pending.get(id) === checked) pending.delete(id)
  }
}

let refreshing: Promise<void> | null = null
function refresh(): Promise<void> {
  refreshing ??= load().finally(() => (refreshing = null))
  return refreshing
}

async function load(): Promise<void> {
  if (ended()) return
  await flush()
  if (ended()) return
  try {
    const before = toggles
    const next = await (await getApi()).items(props.token)
    if (ended()) return
    if (before !== toggles && phase.value === 'list') return
    serverItems.value = next
    phase.value = 'list'
    if (pending.size === 0) offline.value = false
  } catch (e) {
    fail(e)
  }
}

function toggle(item: TakeListItem): void {
  if (phase.value !== 'list') return
  toggles++
  pending.set(item.id, !item.checked)
  void flush()
}

async function finish(): Promise<void> {
  if (phase.value !== 'list' || finishing.value) return
  finishing.value = true
  try {
    await flush()
    if (ended()) return
    await (await getApi()).done(props.token)
    phase.value = 'done'
    offline.value = false
    stopPolling()
  } catch (e) {
    fail(e)
  } finally {
    finishing.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
function stopPolling(): void {
  clearInterval(timer)
  timer = undefined
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
function onVisibility(): void {
  if (visible()) void refresh()
}
function onOnline(): void {
  void refresh()
}
function onOffline(): void {
  if (!ended()) offline.value = true
}

onMounted(() => {
  timer = setInterval(() => {
    if (visible()) void refresh()
  }, POLL_MS)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  void refresh()
})

onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-app px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] text-ink">
    <header class="flex items-center gap-2 px-1.5 py-3">
      <RLogo :size="26" />
      <span class="text-[20px] font-medium">roost family</span>
    </header>

    <p
      v-if="offline && !(phase === 'expired' || phase === 'done')"
      role="status"
      class="mb-3 rounded-[14px] bg-amber-tint px-4 py-3 text-[16px] text-ink"
    >
      You're offline. Check-offs will sync when you're back online.
    </p>

    <p v-if="phase === 'loading' && !offline" role="status" class="px-1.5 py-6 text-[17px] text-ink-3">Loading the list…</p>

    <section v-else-if="phase === 'list'" class="flex flex-1 flex-col gap-3.5 pt-1.5">
      <h1 class="px-1 text-[28px] font-semibold">Grocery list</h1>

      <p v-if="items.length === 0" class="rounded-[16px] bg-surface px-4 py-5 text-[19px] text-ink-3">Nothing on the list</p>
      <ul v-else class="flex flex-col overflow-hidden rounded-[16px] bg-surface" aria-label="Grocery items">
        <li v-for="item in items" :key="item.id" class="border-b border-surface-2 last:border-b-0">
          <button
            type="button"
            role="checkbox"
            :aria-checked="item.checked"
            class="flex min-h-[56px] w-full items-center gap-3.5 px-4 py-2 text-left"
            @click="toggle(item)"
          >
            <span
              aria-hidden="true"
              class="flex size-[28px] shrink-0 items-center justify-center rounded-[9px] border-2 text-[15px] font-bold text-surface"
              :class="item.checked ? 'border-green-deep bg-green-deep' : 'border-ink-3 bg-transparent'"
            >
              {{ item.checked ? '✓' : '' }}
            </span>
            <span class="flex-1 text-[19px] break-words" :class="item.checked ? 'text-ink-3 line-through' : 'text-ink'">{{ item.text }}</span>
          </button>
        </li>
      </ul>

      <div class="flex-1" />
      <p class="text-center text-[13px] text-ink-3">Check-offs sync to the kitchen display. Items can only be added at home.</p>
      <button
        type="button"
        class="min-h-[64px] rounded-[18px] bg-ink text-[19px] font-semibold text-app disabled:opacity-60"
        :disabled="finishing"
        @click="finish"
      >
        Done shopping
      </button>
    </section>

    <section v-else-if="phase === 'expired'" class="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div class="flex size-[96px] items-center justify-center rounded-full bg-surface-2" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="text-ink-3">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h1 class="text-[28px] font-semibold">This list has expired.</h1>
      <p class="text-[17px] leading-snug text-ink-3">Ask for a new one at home.</p>
    </section>

    <section v-else-if="phase === 'done'" class="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div class="flex size-[96px] items-center justify-center rounded-full bg-green-deep" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-surface">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      </div>
      <h1 class="text-[28px] font-semibold">All done</h1>
      <p class="text-[17px] leading-snug text-ink-3">This link has been closed.</p>
    </section>
  </main>
</template>
