<script setup lang="ts">
/**
 * Settings > Logs (spec §7.9, §11.2, §11.4): history per child, type and day, read a page at a time straight
 * from the log tables. Non-dose entries can be edited or deleted (PIN-checked and audited); doses can only be voided with a reason (they
 * stay listed, struck through). Logs older than 2 years can be bulk-deleted per type, never doses.
 */
import { computed, ref, useId, watch } from 'vue'
import type { EntryTable } from '@/data/logCommands'
import type { LogEntryRow, LogTable } from '@/data/settingsApi'
import { formatClock, householdDate } from '@/domain/time'
import { useHouseholdStore } from '@/stores/householdStore'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import SaveRow from '../forms/SaveRow.vue'
import TextAreaField from '../forms/TextAreaField.vue'
import TimeField from '../forms/TimeField.vue'
import {
  AMOUNT_MAX, dayLabel, daysBefore, entryEditFormFrom, itemsOnDay, loadedDays, LOG_TYPES, LOGS_PAGE_SIZE, retentionCutoff,
  toEntryPatch, toLogItem, validateEntryEdit, validateVoidReason, VOID_REASON_MAX,
  type EntryEditErrors, type EntryEditForm, type LogItem, type LogTypeId,
} from '../logsModel'
import { loadSettingsApi } from '../settingsApiLoader'
import { useSettingsSave } from '../useSettingsSave'

const ALL = 'all'

const store = useHouseholdStore()
const pickDateId = useId()

const timeZone = computed(() => store.view?.household.timeZone ?? 'UTC')
const children = computed(() => (store.view ? [...store.view.children].sort((a, b) => a.sortOrder - b.sortOrder) : []))
const childOptions = computed(() => [{ value: ALL, label: 'All children' }, ...children.value.map((c) => ({ value: c.id, label: c.name }))])

const childFilter = ref<string | null>(ALL)
const typeFilter = ref<string | null>('sleep')
const logType = computed(() => LOG_TYPES.find((t) => t.id === typeFilter.value) ?? LOG_TYPES[0]!)
const typeOptions = LOG_TYPES.map((t) => ({ value: t.id, label: t.label }))

const today = computed(() => householdDate(new Date(store.view?.loadedAt ?? Date.now()), timeZone.value))
const yesterday = computed(() => daysBefore(today.value, 1))
const day = ref<string>(today.value)
const dayChip = computed<string | null>({
  get: () => (day.value === today.value || day.value === yesterday.value ? day.value : null),
  set: (value) => {
    if (value) day.value = value
  },
})

// ─── Loading ───────────────────────────────────────────────────────────────
/** The one row whose edit, delete or void panel is open. */
const panel = ref<{ id: string; mode: 'edit' | 'delete' | 'void' } | null>(null)
const rows = ref<LogEntryRow[]>([])
const rowsTable = ref<LogTable>(logType.value.table)
const hasMore = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
let loadToken = 0

function childId(): string | undefined {
  return childFilter.value && childFilter.value !== ALL ? childFilter.value : undefined
}

/** Loads the newest entries again (`limit` rows), or the next page after the loaded ones with `more`. */
async function load(options: { more?: boolean; limit?: number } = {}): Promise<void> {
  const token = ++loadToken
  const table = logType.value.table
  const limit = options.limit ?? LOGS_PAGE_SIZE
  const last = rows.value.at(-1)
  const query = options.more && last
    ? { table, childId: childId(), limit, before: last.at }
    : { table, childId: childId(), limit }
  loading.value = true
  loadError.value = null
  try {
    const api = await loadSettingsApi()
    const page = await api.listEntries(query)
    if (token !== loadToken) return
    rows.value = options.more ? [...rows.value, ...page] : page
    rowsTable.value = table
    hasMore.value = page.length === limit
  } catch {
    if (token !== loadToken) return
    loadError.value = 'Couldn’t load logs. Check the connection and try again.'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

/** Reloads what's shown after a change, keeping as many rows as were loaded. */
function refresh(): Promise<void> {
  const limit = Math.max(LOGS_PAGE_SIZE, Math.ceil(rows.value.length / LOGS_PAGE_SIZE) * LOGS_PAGE_SIZE)
  return load({ limit })
}

watch([childFilter, typeFilter], () => {
  panel.value = null
  rows.value = []
  void load()
}, { immediate: true })

// Another display (or this one) changed household data: show it.
watch(() => store.view?.loadedAt, (next, previous) => {
  if (previous !== undefined && next !== previous) void refresh()
})

const items = computed<LogItem[]>(() => {
  const ctx = {
    medicines: store.view?.medicines ?? [],
    categories: store.view?.stickerCategories ?? [],
    timeZone: timeZone.value,
    now: new Date(),
  }
  return rows.value.map((r) => toLogItem(r, rowsTable.value, ctx)).filter((i): i is LogItem => i !== null)
})
const visible = computed(() => itemsOnDay(items.value, day.value, timeZone.value))
const otherDays = computed(() => loadedDays(items.value, timeZone.value).filter((d) => d !== today.value && d !== yesterday.value))

/** A row's buttons name their entry, e.g. "Edit Milk at 3:10 PM", since every row has the same buttons. */
function rowName(item: LogItem): string {
  return `${item.title} at ${formatClock(new Date(item.at), timeZone.value)}`
}

function childName(id: string): string {
  return children.value.find((c) => c.id === id)?.name ?? ''
}

const emptyMessage = computed(() => {
  const who = childId() ? ` for ${childName(childId()!)}` : ''
  const when = day.value === today.value ? 'today' : day.value === yesterday.value ? 'yesterday' : `on ${dayLabel(day.value, today.value)}`
  return `No ${logType.value.label.toLowerCase()} entries${who} ${when}.`
})

function onPickDate(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value) day.value = value
}

// ─── Row actions ───────────────────────────────────────────────────────────
const editForm = ref<EntryEditForm | null>(null)
const editErrors = ref<EntryEditErrors>({})
const voidReason = ref('')
const voidError = ref<string | null>(null)

const { saving: editSaving, saved: editSaved, error: editError, offline, save: saveEdit } = useSettingsSave()
const { saving: deleting, error: deleteError, save: saveDelete } = useSettingsSave()
const { saving: voiding, error: voidSaveError, save: saveVoid } = useSettingsSave()

function open(item: LogItem, mode: 'edit' | 'delete' | 'void'): void {
  panel.value = { id: item.id, mode }
  if (mode === 'edit') {
    editForm.value = entryEditFormFrom(item, timeZone.value)
    editErrors.value = {}
  }
  if (mode === 'void') {
    voidReason.value = ''
    voidError.value = null
  }
}

function close(): void {
  panel.value = null
  editForm.value = null
}

function isOpen(item: LogItem, mode: 'edit' | 'delete' | 'void'): boolean {
  return panel.value?.id === item.id && panel.value.mode === mode
}

async function submitEdit(item: LogItem): Promise<void> {
  const form = editForm.value
  if (!form || item.table === 'dose_entries') return
  editErrors.value = validateEntryEdit(item, form, timeZone.value, new Date())
  if (Object.keys(editErrors.value).length > 0) return
  const patch = toEntryPatch(item, form, timeZone.value)
  const table: EntryTable = item.table
  const ok = await saveEdit((api, auth) => api.updateEntry(auth, table, item.id, patch))
  if (!ok) return
  close()
  await refresh()
}

async function confirmDelete(item: LogItem): Promise<void> {
  if (item.table === 'dose_entries') return
  const table: EntryTable = item.table
  const ok = await saveDelete((api, auth) => api.deleteEntry(auth, table, item.id))
  if (!ok) return
  close()
  await refresh()
}

async function confirmVoid(item: LogItem): Promise<void> {
  voidError.value = validateVoidReason(voidReason.value)
  if (voidError.value) return
  const reason = voidReason.value.trim()
  const ok = await saveVoid((api, auth) => api.voidDose(auth, item.id, reason))
  if (!ok) return
  close()
  await refresh()
}

// ─── Retention ─────────────────────────────────────────────────────────────
const confirmingPurge = ref(false)
const purgeResult = ref<string | null>(null)
const { saving: purging, error: purgeError, save: savePurge } = useSettingsSave()
const purgeCutoff = computed(() => retentionCutoff(new Date(store.view?.loadedAt ?? Date.now()), timeZone.value))
const purgeCutoffLabel = computed(() =>
  new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: timeZone.value }).format(new Date(purgeCutoff.value)),
)

watch(typeFilter, () => {
  confirmingPurge.value = false
  purgeResult.value = null
})

async function confirmPurge(): Promise<void> {
  const table = logType.value.table
  if (table === 'dose_entries') return
  const before = retentionCutoff(new Date(), timeZone.value)
  let deleted = 0
  const ok = await savePurge(async (api, auth) => {
    deleted = await api.deleteOldEntries(auth, table, before)
  })
  if (!ok) return
  confirmingPurge.value = false
  purgeResult.value = `Deleted ${deleted} ${deleted === 1 ? 'entry' : 'entries'}.`
  await refresh()
}

const feedingTypes = [
  { value: 'milk', label: 'Milk' },
  { value: 'meal', label: 'Meal' },
  { value: 'snack', label: 'Snack' },
]
const diaperKinds = [
  { value: 'wet', label: 'Wet' },
  { value: 'dirty', label: 'Dirty' },
  { value: 'both', label: 'Both' },
]

function typeId(): LogTypeId {
  return logType.value.id
}
</script>

<template>
  <section aria-labelledby="settings-logs-title" class="flex flex-col gap-5">
    <h2 id="settings-logs-title" class="text-[32px] font-semibold text-ink">Logs</h2>

    <div class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <RChips v-model="childFilter" label="Child" :options="childOptions" />
      <RChips v-model="typeFilter" label="Type" :options="typeOptions" />
      <div class="flex flex-wrap items-end gap-4">
        <RChips
          v-model="dayChip"
          label="Day"
          :options="[{ value: today, label: 'Today' }, { value: yesterday, label: 'Yesterday' }]"
        />
        <div class="flex flex-col gap-2">
          <label :for="pickDateId" class="text-[18px] font-medium text-ink-2">Pick a date</label>
          <select
            :id="pickDateId"
            :value="dayChip === null ? day : ''"
            class="min-h-[60px] min-w-[220px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[20px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
            @change="onPickDate"
          >
            <option value="" disabled>{{ otherDays.length > 0 ? 'Earlier loaded day…' : 'Load more for earlier days' }}</option>
            <option v-for="d in otherDays" :key="d" :value="d">{{ dayLabel(d, today) }}</option>
          </select>
        </div>
      </div>
    </div>

    <p v-if="loadError" role="alert" class="text-[18px] text-warn-ink">{{ loadError }}</p>

    <div class="rounded-[var(--radius-card)] bg-surface px-6 py-3">
      <ul class="flex flex-col">
        <li
          v-for="item in visible"
          :key="item.id"
          data-testid="log-row"
          class="flex flex-col gap-3 border-b border-line py-3 last:border-b-0"
        >
          <div class="flex flex-wrap items-center gap-4">
            <span class="w-[104px] shrink-0 text-[20px] font-semibold text-ink tabular-nums">{{ formatClock(new Date(item.at), timeZone) }}</span>
            <div class="flex min-w-[200px] flex-1 flex-col">
              <span class="text-[20px] font-medium text-ink" :class="item.voided && 'line-through'">
                {{ item.title }}<template v-if="!childId()"> · {{ childName(item.childId) }}</template>
              </span>
              <span v-if="item.detail" class="text-[18px] text-ink-2" :class="item.voided && 'line-through'">{{ item.detail }}</span>
              <span v-if="item.voided" class="text-[18px] text-warn-ink">Voided: {{ item.voidReason }}</span>
              <span v-if="item.loggedByName" class="text-[18px] text-ink-3">Logged by {{ item.loggedByName }}</span>
            </div>
            <div v-if="panel?.id !== item.id" class="flex gap-2">
              <template v-if="item.editable">
                <RButton variant="secondary" :aria-label="`Edit ${rowName(item)}`" @click="open(item, 'edit')">Edit</RButton>
                <RButton variant="ghost" :aria-label="`Delete ${rowName(item)}`" @click="open(item, 'delete')">Delete</RButton>
              </template>
              <RButton v-else-if="!item.voided" variant="secondary" :aria-label="`Void ${rowName(item)}`" @click="open(item, 'void')">Void</RButton>
            </div>
          </div>

          <div v-if="isOpen(item, 'edit') && editForm" class="flex flex-col gap-4 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4">
            <div class="grid grid-cols-2 gap-4">
              <RInput v-model="editForm.date" :label="item.table === 'sleep_entries' ? 'Start date' : 'Date'" type="date" />
              <TimeField v-model="editForm.time" :label="item.table === 'sleep_entries' ? 'Start time' : 'Time'" :error="editErrors.time" />
            </div>
            <div v-if="item.table === 'sleep_entries' && editForm.hasEnd" class="grid grid-cols-2 gap-4">
              <RInput v-model="editForm.endDate" label="End date" type="date" />
              <TimeField v-model="editForm.endTime" label="End time" :error="editErrors.end" />
            </div>
            <template v-if="item.table === 'feeding_entries'">
              <RChips v-model="editForm.type as string | null" label="Feeding type" :options="feedingTypes" />
              <div class="flex flex-col gap-2">
                <RInput v-model="editForm.amount" label="Amount" autocomplete="off" :maxlength="AMOUNT_MAX" />
                <p v-if="editErrors.amount" class="text-[18px] text-warn-ink">{{ editErrors.amount }}</p>
              </div>
            </template>
            <RChips v-if="item.table === 'diaper_entries'" v-model="editForm.kind as string | null" label="Diaper kind" :options="diaperKinds" />
            <div class="flex flex-wrap items-center gap-4">
              <RButton variant="secondary" @click="close">Cancel</RButton>
              <SaveRow :saving="editSaving" :saved="editSaved" :error="editError" :disabled="offline" @save="submitEdit(item)" />
            </div>
          </div>

          <div v-if="isOpen(item, 'delete')" class="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4">
            <p class="text-[20px] text-ink">Delete this entry? This can’t be undone.</p>
            <div class="flex gap-3">
              <RButton variant="secondary" :disabled="deleting" @click="close">Cancel</RButton>
              <RButton variant="danger" :disabled="deleting || offline" @click="confirmDelete(item)">Delete entry</RButton>
            </div>
            <p v-if="deleteError" role="alert" class="text-[18px] text-warn-ink">{{ deleteError }}</p>
          </div>

          <div v-if="isOpen(item, 'void')" class="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4">
            <p class="text-[18px] text-ink-2">Doses are never deleted. A voided dose stays in Logs with its reason and no longer counts.</p>
            <TextAreaField v-model="voidReason" label="Reason" :maxlength="VOID_REASON_MAX" :rows="2" />
            <p v-if="voidError" class="text-[18px] text-warn-ink">{{ voidError }}</p>
            <div class="flex gap-3">
              <RButton variant="secondary" :disabled="voiding" @click="close">Cancel</RButton>
              <RButton variant="danger" :disabled="voiding || offline" @click="confirmVoid(item)">Void dose</RButton>
            </div>
            <p v-if="voidSaveError" role="alert" class="text-[18px] text-warn-ink">{{ voidSaveError }}</p>
          </div>
        </li>
        <li v-if="visible.length === 0 && !loading" class="py-3 text-[18px] text-ink-3">{{ emptyMessage }}</li>
      </ul>
    </div>

    <div v-if="hasMore">
      <RButton variant="secondary" :disabled="loading" @click="load({ more: true })">Load more</RButton>
    </div>

    <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
      <h3 class="text-[22px] font-semibold text-ink">Old logs</h3>
      <p v-if="typeId() === 'medicine'" class="text-[18px] text-ink-3">Doses are never deleted. They stay in Logs, voided or not.</p>
      <template v-else>
        <p class="text-[18px] text-ink-3">Roost Family keeps logs until you delete them.</p>
        <template v-if="confirmingPurge">
          <p class="text-[20px] text-ink">
            Delete every {{ logType.label.toLowerCase() }} entry from before {{ purgeCutoffLabel }}? This can’t be undone.
          </p>
          <div class="flex gap-3">
            <RButton variant="secondary" :disabled="purging" @click="confirmingPurge = false">Cancel</RButton>
            <RButton variant="danger" :disabled="purging || offline" @click="confirmPurge">Delete old logs</RButton>
          </div>
        </template>
        <div v-else>
          <RButton variant="secondary" :disabled="offline" @click="confirmingPurge = true; purgeResult = null">
            Delete {{ logType.label.toLowerCase() }} logs older than 2 years
          </RButton>
        </div>
        <p v-if="purgeError" role="alert" class="text-[18px] text-warn-ink">{{ purgeError }}</p>
        <p v-if="purgeResult" role="status" class="text-[18px] font-medium text-green-deep">{{ purgeResult }}</p>
      </template>
    </div>
  </section>
</template>
