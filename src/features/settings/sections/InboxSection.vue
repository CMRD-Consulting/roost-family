<script setup lang="ts">
/**
 * Settings > Inbox (spec §7.9): open jots, newest first, each checked off or deleted; jots done in the last 7
 * days sit collapsed below. Open jots come from the live household view; done ones are read from the jots
 * table (the view only carries open jots).
 */
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import type { Tables } from '@/data/database.types'
import { toJot } from '@/data/mappers'
import type { Jot } from '@/data/snapshot'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import { openJots, recentlyDoneJots } from '../inboxModel'
import { loadSettingsApi } from '../settingsApiLoader'
import { useSettingsSave } from '../useSettingsSave'

const DONE_LIMIT = 200

const store = useHouseholdStore()
const now = useNow(60_000)

/** Ids changed here that the household view hasn't caught up with yet. */
const doneHere = ref(new Set<string>())
const deletedHere = ref(new Set<string>())

const listed = ref<Jot[]>([])

async function loadDone(): Promise<void> {
  try {
    const api = await loadSettingsApi()
    const rows = await api.listEntries({ table: 'jots', limit: DONE_LIMIT })
    listed.value = rows.map((r) => toJot(r.row as Tables<'jots'>))
  } catch {
    // The done list is secondary; keep what was shown.
  }
}

void loadDone()
watch(() => store.view?.loadedAt, (next, previous) => {
  if (previous !== undefined && next !== previous) void loadDone()
})

const open = computed(() =>
  openJots(store.view?.jots ?? []).filter((j) => !doneHere.value.has(j.id) && !deletedHere.value.has(j.id)),
)
const done = computed(() => recentlyDoneJots(listed.value, now.value).filter((j) => !deletedHere.value.has(j.id)))
const showDone = ref(false)

const timeZone = computed(() => store.view?.household.timeZone ?? 'UTC')
function when(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: timeZone.value }).format(new Date(iso))
}

const { saving: checking, error: checkError, offline, save: saveCheck } = useSettingsSave()

async function markDone(jot: Jot): Promise<void> {
  const doneAt = new Date().toISOString()
  const ok = await saveCheck((api, auth) => api.updateEntry(auth, 'jots', jot.id, { doneAt }))
  if (!ok) return
  doneHere.value = new Set([...doneHere.value, jot.id])
  listed.value = [...listed.value.filter((j) => j.id !== jot.id), { ...jot, doneAt }]
  await loadDone()
}

const deletingId = ref<string | null>(null)
const { saving: deleting, error: deleteError, save: saveDelete } = useSettingsSave()

async function confirmDelete(jot: Jot): Promise<void> {
  const ok = await saveDelete((api, auth) => api.deleteEntry(auth, 'jots', jot.id))
  if (!ok) return
  deletingId.value = null
  deletedHere.value = new Set([...deletedHere.value, jot.id])
  await loadDone()
}
</script>

<template>
  <section aria-labelledby="settings-inbox-title" class="flex flex-col gap-5">
    <h2 id="settings-inbox-title" class="text-[32px] font-semibold text-ink">Inbox</h2>
    <p class="text-[18px] text-ink-3">Jots from the main screen. Check them off when they’re handled.</p>

    <p v-if="checkError" role="alert" class="text-[18px] text-warn-ink">{{ checkError }}</p>

    <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
      <ul class="flex flex-col">
        <li v-for="jot in open" :key="jot.id" data-testid="open-jot" class="flex flex-col gap-3 border-b border-line py-3 last:border-b-0">
          <div class="flex items-center gap-4">
            <button
              type="button"
              :aria-label="`Mark done: ${jot.text}`"
              :disabled="checking || offline"
              class="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-ink-3 text-[22px] text-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              @click="markDone(jot)"
            >
              <span aria-hidden="true">✓</span>
            </button>
            <div class="flex flex-1 flex-col">
              <span class="text-[20px] text-ink">{{ jot.text }}</span>
              <span class="text-[18px] text-ink-3">{{ when(jot.createdAt) }}</span>
            </div>
            <RButton v-if="deletingId !== jot.id" variant="ghost" :aria-label="`Delete: ${jot.text}`" @click="deletingId = jot.id">Delete</RButton>
          </div>
          <div v-if="deletingId === jot.id" class="flex flex-col gap-3">
            <p class="text-[20px] text-ink">Delete this jot?</p>
            <div class="flex gap-3">
              <RButton variant="secondary" :disabled="deleting" @click="deletingId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="deleting || offline" @click="confirmDelete(jot)">Delete jot</RButton>
            </div>
            <p v-if="deleteError" role="alert" class="text-[18px] text-warn-ink">{{ deleteError }}</p>
          </div>
        </li>
        <li v-if="open.length === 0" class="py-3 text-[18px] text-ink-3">No open jots.</li>
      </ul>
    </div>

    <div v-if="done.length > 0" class="flex flex-col gap-3">
      <div>
        <RButton variant="secondary" :aria-expanded="showDone" @click="showDone = !showDone">
          Done in the last 7 days ({{ done.length }})
        </RButton>
      </div>
      <ul v-if="showDone" class="flex flex-col rounded-[var(--radius-card)] bg-surface px-6 py-3">
        <li v-for="jot in done" :key="jot.id" class="flex flex-col gap-3 border-b border-line py-3 last:border-b-0">
          <div class="flex items-center gap-4">
            <div class="flex flex-1 flex-col">
              <span class="text-[20px] text-ink-2 line-through">{{ jot.text }}</span>
              <span class="text-[18px] text-ink-3">Done {{ jot.doneAt ? when(jot.doneAt) : '' }}</span>
            </div>
            <RButton v-if="deletingId !== jot.id" variant="ghost" :aria-label="`Delete: ${jot.text}`" @click="deletingId = jot.id">Delete</RButton>
          </div>
          <div v-if="deletingId === jot.id" class="flex flex-col gap-3">
            <p class="text-[20px] text-ink">Delete this jot?</p>
            <div class="flex gap-3">
              <RButton variant="secondary" :disabled="deleting" @click="deletingId = null">Cancel</RButton>
              <RButton variant="danger" :disabled="deleting || offline" @click="confirmDelete(jot)">Delete jot</RButton>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
