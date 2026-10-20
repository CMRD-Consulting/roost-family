<script setup lang="ts">
/**
 * Add event, from the Today panel (spec §5.5, §7.2, §7.3): an adult puts an event straight into a connected Google
 * calendar. Roost stores nothing (§11.2); the panel shows the new row until the next refresh brings it back from the
 * provider.
 *
 * It is PIN-authorised, like every other guarded action on the main screen: the same `RPinPad` the dose dialogs use,
 * and the membership and PIN are re-sent with the write, which the server checks again (§6.3). There is no second
 * sign-in and no offline queue — writing needs the provider, so with no connection the sheet says so.
 *
 * What can be written to is read **before** the PIN (a display may read its household's connections), so an adult is
 * told why Add event cannot be used instead of typing a PIN to find out. Only calendars that are shown on the
 * displays are offered: an event written to a hidden one would appear nowhere.
 */
import { computed, ref, watch } from 'vue'
import {
  CalendarError,
  createCalendarSettingsApi,
  loadCalendarClient,
  addDemoEvent,
  type CalendarSettingsApi,
  type HouseholdConnection,
  type TodayEvent,
} from '@/data/calendarApi'
import { isDemo } from '@/data/householdSource'
import type { RoostClient } from '@/data/supabase'
import { householdDate, householdWallTime, shiftHouseholdDate } from '@/domain/time'
import { useHouseholdStore } from '@/stores/householdStore'
import { useLogStore } from '@/stores/logStore'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RChips, { type ChipOption } from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import RPinPad from '@/ui/RPinPad.vue'
import RSheet from '@/ui/RSheet.vue'
import { useRovingRadio } from '@/ui/useRovingRadio'
import {
  DURATION_CHOICES,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  PICK_A_DATE,
  addEventBlock,
  addEventBlockMessage,
  addEventFailureMessage,
  assigneeOf,
  buildNewEvent,
  dateLabel,
  durationLabel,
  eventPeople,
  formProblem,
  newEventForm,
  optimisticRow,
  personKeyOf,
  resolveCalendar,
  writableCalendars,
  type EventPerson,
} from './addEventModel'

const props = withDefaults(defineProps<{ open: boolean; api?: CalendarSettingsApi; client?: RoostClient }>(), {})
const emit = defineEmits<{ close: []; added: [event: TodayEvent] }>()

const store = useHouseholdStore()
const logStore = useLogStore()
const api = props.api ?? createCalendarSettingsApi()

/** The demo has no provider: one pretend calendar per person, written to `addDemoEvent` in memory. */
const DEMO_SELECTION_PREFIX = 'demo:'

const view = computed(() => store.view)
const timeZone = computed(() => view.value?.household.timeZone ?? 'UTC')
const online = computed(() => store.online !== false)
const people = computed(() => eventPeople(view.value?.members ?? [], view.value?.children ?? []))
const adults = computed(() => (view.value?.members ?? []).filter((m) => m.role === 'owner' || m.role === 'adult'))

const connections = ref<HouseholdConnection[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
/** The verified Settings PIN for this write; held only while the sheet is open. */
const auth = ref<{ membershipId: string; pin: string } | null>(null)
const pinKey = ref(0)
const saving = ref(false)
const error = ref<string | null>(null)

const now = () => new Date()
const form = ref(newEventForm(now(), timeZone.value))

/** In the demo every person has a calendar of their own; otherwise only the acting adult's own writable ones. */
const demoConnections = computed<HouseholdConnection[]>(() =>
  people.value.map((person, i) => ({
    id: `demo-conn-${i}`,
    membershipId: auth.value?.membershipId ?? '',
    provider: 'google',
    label: 'Demo calendar',
    status: 'ok',
    canWrite: true,
    calendars: [{ id: `${DEMO_SELECTION_PREFIX}${personKeyOf(person)}`, name: person.name, visible: true, gone: false, assignee: person }],
  })),
)

const householdConnections = computed(() => (isDemo ? demoConnections.value : connections.value))
/** Before the PIN: can anyone here add an event at all? */
const block = computed(() => addEventBlock(householdConnections.value, online.value))
const mine = computed(() => householdConnections.value.filter((c) => c.membershipId === auth.value?.membershipId))
const calendars = computed(() => writableCalendars(mine.value))
/** After the PIN: can *this* adult add one? */
const myBlock = computed(() => (auth.value ? addEventBlock(mine.value, online.value) : null))

const today = computed(() => householdDate(now(), timeZone.value))
const person = computed<EventPerson | null>(() => {
  const assignee = assigneeOf(form.value.personKey)
  return assignee ? (people.value.find((p) => personKeyOf(p) === personKeyOf(assignee)) ?? null) : null
})
const target = computed(() => resolveCalendar(form.value, calendars.value))
/** The person has no writable calendar of their own, so the adult is asked which to use. */
const needsCalendarChoice = computed(() => person.value !== null && !target.value)
const problem = computed(() => formProblem(form.value, calendars.value))

const dateOptions = computed<ChipOption[]>(() => {
  const tomorrow = shiftHouseholdDate(today.value, 1)
  return [
    { value: today.value, label: 'Today' },
    { value: tomorrow, label: 'Tomorrow' },
    { value: PICK_A_DATE, label: 'Pick a date' },
  ]
})
const durationOptions = computed<ChipOption[]>(() => DURATION_CHOICES.map((m) => ({ value: String(m), label: durationLabel(m) })))
const calendarOptions = computed<ChipOption[]>(() =>
  calendars.value.map((c) => ({ value: c.selectionId, label: c.name, detail: c.accountLabel })),
)
const durationModel = computed({
  get: () => String(form.value.durationMin),
  set: (value: string | null) => {
    if (value) form.value.durationMin = Number(value)
  },
})
const dateChoiceModel = computed({
  get: () => form.value.dateChoice as string,
  set: (value: string | null) => {
    if (value) form.value.dateChoice = value as typeof form.value.dateChoice
  },
})
const selectionModel = computed({
  get: () => form.value.selectionId,
  set: (value: string | null) => (form.value.selectionId = value),
})

const { optionRefs, tabindexFor, onKeydown } = useRovingRadio(
  () => people.value.map((p) => personKeyOf(p)),
  computed({
    get: () => form.value.personKey,
    set: (value: string | null) => pickPerson(value),
  }),
)

function pickPerson(key: string | null): void {
  form.value.personKey = key
  // The picked calendar belonged to the previous person; fall back to this one's own.
  form.value.selectionId = null
}

/** "Today · 4:00 PM – 4:45 PM", or "Tomorrow · All day": what will be written, in one line. */
const summary = computed(() => {
  const built = buildNewEvent(form.value, calendars.value, timeZone.value)
  if (!built) return null
  const day = dateLabel(built.allDay ? built.start : householdDate(new Date(built.start), timeZone.value), today.value, timeZone.value)
  if (built.allDay) return `${day} · All day`
  const time = new Intl.DateTimeFormat('en-US', { timeZone: timeZone.value, hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time.format(new Date(built.start))} – ${time.format(new Date(built.end))}`
})

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      auth.value = null
      return
    }
    form.value = newEventForm(now(), timeZone.value)
    auth.value = null
    error.value = null
    loadError.value = null
    pinKey.value++
    if (isDemo || !online.value) return
    const householdId = view.value?.household.id
    if (!householdId) return
    loading.value = true
    try {
      const client = props.client ?? (await loadCalendarClient())
      connections.value = await api.listHouseholdConnections(client, householdId)
    } catch (e) {
      loadError.value = `Couldn’t check your calendars. ${addEventFailureMessage(e)}`
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function verify(membershipId: string, pin: string): Promise<boolean> {
  return logStore.verifyPin(membershipId, pin)
}

function onVerified(verified: { membershipId: string; pin: string }): void {
  auth.value = verified
  error.value = null
}

async function save(): Promise<void> {
  const householdId = view.value?.household.id
  const chosen = person.value
  const pin = auth.value
  const built = buildNewEvent(form.value, calendars.value, timeZone.value)
  if (!householdId || !chosen || !pin || !built || saving.value) return
  saving.value = true
  error.value = null
  try {
    if (isDemo) {
      const row = optimisticRow(
        {
          selectionId: built.selectionId,
          title: built.title,
          startAt: demoInstant(built.start),
          endAt: demoInstant(built.end),
          allDay: built.allDay,
          location: built.location ?? null,
        },
        chosen,
      )
      addDemoEvent(row)
      emit('added', row)
    } else {
      const client = props.client ?? (await loadCalendarClient())
      emit('added', optimisticRow(await api.createEventWithPin(client, householdId, pin, built), chosen))
    }
  } catch (e) {
    error.value = addEventFailureMessage(e, 'pin')
    // A refused PIN sends the adult back to the pad; anything else leaves the form as it was.
    if (e instanceof CalendarError && e.code === 'forbidden') {
      auth.value = null
      pinKey.value++
    }
    return
  } finally {
    saving.value = false
  }
  emit('close')
}

/**
 * The instant the panel sorts an event by. An all-day event is given to the provider as a household date, and the
 * real function answers with midnight in the household zone; the demo does the same sum itself.
 */
function demoInstant(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? householdWallTime(value, '00:00', timeZone.value).toISOString() : value
}
</script>

<template>
  <RSheet title="Add event" :open="open" @close="emit('close')">
    <div class="flex flex-col gap-6">
      <!-- Outside the form, so a refusal that sends the adult back to the PIN pad is still on screen there. -->
      <p v-if="error" role="alert" data-testid="add-event-error" class="text-[20px] leading-snug text-warn-ink">{{ error }}</p>

      <!-- Nothing to write to: say why, rather than asking for a PIN first. -->
      <template v-if="block">
        <p role="status" data-testid="add-event-block" class="text-[22px] leading-snug text-ink">{{ addEventBlockMessage(block) }}</p>
      </template>

      <template v-else-if="loading">
        <p role="status" class="text-[22px] text-ink-2">Checking your calendars…</p>
      </template>

      <template v-else-if="loadError">
        <p role="alert" class="text-[20px] text-warn-ink">{{ loadError }}</p>
      </template>

      <!-- The adult PIN authorises the write (spec §6.3), re-checked by the server on the call itself. -->
      <template v-else-if="!auth">
        <RPinPad :key="pinKey" :members="adults" :verify="verify" title="Enter your PIN to add an event" @verified="onVerified" @cancel="emit('close')" />
      </template>

      <template v-else-if="myBlock">
        <p role="status" data-testid="add-event-mine-block" class="text-[22px] leading-snug text-ink">{{ addEventBlockMessage(myBlock) }}</p>
      </template>

      <form v-else class="add-event-form flex flex-col gap-6" @submit.prevent="save">
        <div class="flex flex-col gap-3">
          <p class="text-[18px] font-semibold uppercase tracking-wide text-ink-3">Who is it for?</p>
          <div role="radiogroup" aria-label="Who is it for?" class="flex flex-wrap gap-3">
            <button
              v-for="(p, i) in people"
              :key="personKeyOf(p)"
              ref="optionRefs"
              type="button"
              role="radio"
              :aria-checked="form.personKey === personKeyOf(p)"
              :tabindex="tabindexFor(i)"
              :data-testid="`event-person-${p.id}`"
              class="flex min-h-[60px] items-center gap-2 rounded-full border-[3px] bg-surface-2 pr-5 pl-1"
              :class="form.personKey === personKeyOf(p) ? 'border-ink' : 'border-transparent'"
              @click="pickPerson(personKeyOf(p))"
              @keydown="onKeydown($event, i)"
            >
              <RAvatar :name="p.name" :color="p.color" :size="44" decorative />
              <span class="text-[19px] font-medium text-ink">{{ p.name }}</span>
            </button>
          </div>
        </div>

        <RInput v-model="form.title" label="What is it?" :maxlength="MAX_EVENT_TITLE" />

        <div class="flex flex-col gap-3">
          <p class="text-[18px] font-semibold uppercase tracking-wide text-ink-3">When</p>
          <RChips v-model="dateChoiceModel" label="Day" :options="dateOptions" />
          <label v-if="form.dateChoice === PICK_A_DATE" class="flex flex-col gap-2">
            <span class="text-[18px] font-medium text-ink-2">Date</span>
            <input
              v-model="form.pickedDate"
              data-testid="event-date"
              type="date"
              class="min-h-[60px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
            />
          </label>
        </div>

        <button
          type="button"
          role="switch"
          :aria-checked="form.allDay"
          data-testid="event-all-day"
          class="flex min-h-[60px] items-center gap-3 self-start rounded-[var(--radius-control)] px-2 text-[20px] font-medium text-ink"
          @click="form.allDay = !form.allDay"
        >
          <span class="relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors" :class="form.allDay ? 'bg-green-deep' : 'bg-ink-3'" aria-hidden="true">
            <span class="absolute top-1 h-6 w-6 rounded-full bg-surface transition-[left]" :class="form.allDay ? 'left-7' : 'left-1'" />
          </span>
          All day
        </button>

        <template v-if="!form.allDay">
          <label class="flex flex-col gap-2">
            <span class="text-[18px] font-semibold uppercase tracking-wide text-ink-3">Starts</span>
            <input
              v-model="form.startTime"
              data-testid="event-start"
              type="time"
              step="300"
              class="min-h-[60px] w-[220px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[24px] tabular-nums text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
            />
          </label>
          <div class="flex flex-col gap-3">
            <p class="text-[18px] font-semibold uppercase tracking-wide text-ink-3">How long</p>
            <RChips v-model="durationModel" label="How long" :options="durationOptions" />
          </div>
        </template>

        <RInput v-model="form.location" label="Where (optional)" :maxlength="MAX_EVENT_LOCATION" />

        <!-- The person's own calendar is used without asking; only when they have none is a choice needed. -->
        <div v-if="needsCalendarChoice" class="flex flex-col gap-3">
          <p role="status" data-testid="event-calendar-note" class="text-[18px] font-medium text-orange-deep">
            {{ person?.name }}’s calendar can’t be added to. Choose one of yours.
          </p>
          <RChips v-model="selectionModel" label="Add to which calendar?" :options="calendarOptions" />
        </div>
        <p v-else-if="target" data-testid="event-calendar" class="text-[18px] text-ink-3">
          Adding to {{ target.name }} · {{ target.accountLabel }}
        </p>

        <p v-if="summary" data-testid="event-summary" class="text-[20px] font-medium text-ink">{{ summary }}</p>
        <p v-else-if="problem" data-testid="event-problem" class="text-[18px] text-ink-2">{{ problem }}</p>
      </form>
    </div>

    <template #footer>
      <RButton v-if="block || loadError || myBlock" variant="secondary" tier="moment" class="w-full" @click="emit('close')">Close</RButton>
      <RButton
        v-else-if="auth"
        tier="moment"
        class="w-full"
        data-testid="event-save"
        :disabled="problem !== null || saving"
        @click="save"
      >
        {{ saving ? 'Adding…' : 'Add event' }}
      </RButton>
    </template>
  </RSheet>
</template>

<style scoped>
/* The main screen is an in-the-moment surface, so every field is a 60 pt target (spec §4); the shared RInput is
   sized for Settings' 44 pt floor. */
.add-event-form :deep(input) {
  min-height: 60px;
}
</style>
