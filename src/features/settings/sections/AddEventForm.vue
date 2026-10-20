<script setup lang="ts">
/**
 * Add an event, in the Calendars section of Manage household (spec §5.5, §6.3, §7.10). The adult's own email
 * sign-in authorises it here, so there is no PIN — the tablet's sheet (`AddEventSheet`) is the PIN path.
 *
 * A deliberate surface, so 44 pt targets. The rules (which calendars may be written to, what makes a complete
 * event, how a day and a wall clock become instants) are the Today panel's, from `addEventModel`.
 */
import { computed, ref, watch } from 'vue'
import type { CalendarPerson, CreatedEvent, MyConnection, NewEvent } from '@/data/calendarApi'
import {
  DURATION_CHOICES,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  PICK_A_DATE,
  addEventBlock,
  addEventBlockMessage,
  addEventFailureMessage,
  buildNewEvent,
  dateLabel,
  durationLabel,
  formProblem,
  newEventForm,
  personKeyOf,
  resolveCalendar,
  writableCalendars,
} from '@/features/main/addEventModel'
import { householdDate, shiftHouseholdDate } from '@/domain/time'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'

const props = defineProps<{
  /** The adult's own connections, as the section loaded them. */
  connections: MyConnection[]
  people: CalendarPerson[]
  timeZone: string
  /** Writes the event, and throws a CalendarError on refusal. */
  save: (event: NewEvent) => Promise<CreatedEvent>
  headingLevel?: 2 | 3
}>()

const headingTag = computed(() => `h${props.headingLevel ?? 3}`)

const now = () => new Date()
const form = ref(newEventForm(now(), props.timeZone))
const saving = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const calendars = computed(() => writableCalendars(props.connections))
const block = computed(() => addEventBlock(props.connections, true))
const today = computed(() => householdDate(now(), props.timeZone))
const person = computed(() => props.people.find((p) => personKeyOf(p) === form.value.personKey) ?? null)
const target = computed(() => resolveCalendar(form.value, calendars.value))
const needsCalendarChoice = computed(() => person.value !== null && !target.value)
const problem = computed(() => formProblem(form.value, calendars.value))

const dayChoices = computed(() => [today.value, shiftHouseholdDate(today.value, 1), PICK_A_DATE])

function pickPerson(key: string): void {
  form.value.personKey = key
  form.value.selectionId = null
}

watch(
  () => props.timeZone,
  (zone) => (form.value = newEventForm(now(), zone)),
)

async function submit(): Promise<void> {
  const built = buildNewEvent(form.value, calendars.value, props.timeZone)
  if (!built || saving.value) return
  saving.value = true
  error.value = null
  notice.value = null
  try {
    const created = await props.save(built)
    notice.value = `Added “${created.title}”. It will show on your displays within a few minutes.`
    form.value = newEventForm(now(), props.timeZone)
  } catch (e) {
    error.value = addEventFailureMessage(e, 'account')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
    <component :is="headingTag" class="text-[22px] font-semibold text-ink">Add an event</component>

    <p v-if="block" data-testid="manage-add-event-block" class="text-[18px] text-ink-2">{{ addEventBlockMessage(block) }}</p>

    <template v-else>
      <p class="text-[18px] text-ink-2">
        The event goes straight into your connected calendar. Roost Family never saves it — your displays read it back
        from the provider.
      </p>
      <p v-if="notice" role="status" data-testid="manage-add-event-notice" class="text-[18px] font-medium text-green-deep">{{ notice }}</p>
      <p v-if="error" role="alert" data-testid="manage-add-event-error" class="text-[18px] text-warn-ink">{{ error }}</p>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <p class="text-[18px] font-medium text-ink-2">Who is it for?</p>
          <div role="radiogroup" aria-label="Who is the event for?" class="flex flex-wrap gap-2">
            <button
              v-for="p in people"
              :key="personKeyOf(p)"
              type="button"
              role="radio"
              :aria-checked="form.personKey === personKeyOf(p)"
              :data-testid="`manage-event-person-${p.id}`"
              class="flex min-h-[44px] items-center gap-2 rounded-full py-1 pr-4 pl-1 text-[18px] font-medium focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
              :class="form.personKey === personKeyOf(p) ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
              @click="pickPerson(personKeyOf(p))"
            >
              <RAvatar :name="p.name" :color="p.color" :size="36" decorative />
              {{ p.name }}
            </button>
          </div>
        </div>

        <RInput v-model="form.title" label="What is it?" :maxlength="MAX_EVENT_TITLE" />

        <div class="flex flex-wrap items-end gap-4">
          <label class="flex flex-col gap-2">
            <span class="text-[18px] font-medium text-ink-2">Day</span>
            <select
              v-model="form.dateChoice"
              data-testid="manage-event-day"
              class="min-h-[44px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-3 text-[18px] text-ink"
            >
              <option v-for="choice in dayChoices" :key="choice" :value="choice">
                {{ choice === PICK_A_DATE ? 'Another day' : dateLabel(choice, today, timeZone) }}
              </option>
            </select>
          </label>
          <label v-if="form.dateChoice === PICK_A_DATE" class="flex flex-col gap-2">
            <span class="text-[18px] font-medium text-ink-2">Date</span>
            <input
              v-model="form.pickedDate"
              data-testid="manage-event-date"
              type="date"
              class="min-h-[44px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-3 text-[18px] text-ink"
            />
          </label>
          <label class="flex min-h-[44px] items-center gap-2 text-[18px] font-medium text-ink">
            <input v-model="form.allDay" data-testid="manage-event-all-day" type="checkbox" class="h-6 w-6" />
            All day
          </label>
          <template v-if="!form.allDay">
            <label class="flex flex-col gap-2">
              <span class="text-[18px] font-medium text-ink-2">Starts</span>
              <input
                v-model="form.startTime"
                data-testid="manage-event-start"
                type="time"
                step="300"
                class="min-h-[44px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-3 text-[18px] tabular-nums text-ink"
              />
            </label>
            <label class="flex flex-col gap-2">
              <span class="text-[18px] font-medium text-ink-2">How long</span>
              <select
                v-model.number="form.durationMin"
                data-testid="manage-event-duration"
                class="min-h-[44px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-3 text-[18px] text-ink"
              >
                <option v-for="minutes in DURATION_CHOICES" :key="minutes" :value="minutes">{{ durationLabel(minutes) }}</option>
              </select>
            </label>
          </template>
        </div>

        <RInput v-model="form.location" label="Where (optional)" :maxlength="MAX_EVENT_LOCATION" />

        <!-- Only when the chosen person has no writable calendar of their own is a choice needed. -->
        <label v-if="needsCalendarChoice" class="flex flex-col gap-2">
          <span data-testid="manage-event-calendar-note" class="text-[18px] font-medium text-orange-deep">
            {{ person?.name }}’s calendar can’t be added to. Choose one of yours.
          </span>
          <select
            v-model="form.selectionId"
            data-testid="manage-event-calendar"
            class="min-h-[44px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-3 text-[18px] text-ink"
          >
            <option :value="null">Choose a calendar…</option>
            <option v-for="calendar in calendars" :key="calendar.selectionId" :value="calendar.selectionId">
              {{ calendar.name }} · {{ calendar.accountLabel }}
            </option>
          </select>
        </label>
        <p v-else-if="target" data-testid="manage-event-target" class="text-[18px] text-ink-3">
          Adding to {{ target.name }} · {{ target.accountLabel }}
        </p>

        <p v-if="problem" data-testid="manage-event-problem" class="text-[18px] text-ink-3">{{ problem }}</p>
        <div>
          <RButton type="submit" data-testid="manage-event-save" :disabled="problem !== null || saving">
            {{ saving ? 'Adding…' : 'Add event' }}
          </RButton>
        </div>
      </form>
    </template>
  </div>
</template>
