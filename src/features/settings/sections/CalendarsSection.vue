<script setup lang="ts">
/**
 * My calendars (spec §5.5, §7.9, §7.10): one adult's own calendar connections. Connect a calendar link (ICS), connect
 * Google or Microsoft, show each calendar on the displays and choose whose it is (a member or a child: a shown
 * calendar needs exactly one person), and disconnect.
 *
 * How the caller is authorised depends on the surface (spec §6.3). Manage household passes its signed-in adult's
 * client and no `pin`. Settings on a display passes the display's own client and the open Settings PIN session, which
 * authorises every change there — no second, email-code sign-in. Reading is the same either way.
 *
 * Google and Microsoft connect only from Manage household (`surface: 'browser'`). The provider sends the browser back
 * to /manage, and a tablet can't finish there: its full sign-in is never persisted, and /settings needs the PIN
 * session, so a full reload after the redirect would land on the main screen. On a display the buttons stay disabled
 * with a note to use Manage household on a phone or computer.
 *
 * While a change is saving, controls are `aria-disabled` (not `disabled`) and ignore input, so the focused switch,
 * person or button keeps focus. After connecting, focus moves to the new connection (or the notice); after
 * disconnecting, to the notice. Emits `busy` so the host can hold off its idle sign-out.
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import {
  calendarConnectMessage,
  createCalendarSettingsApi,
  type Assignee,
  type CalendarPerson,
  type CalendarSettingsApi,
  type MyCalendar,
  type MyConnection,
} from '@/data/calendarApi'
import { isDemo } from '@/data/householdSource'
import type { AdultClient, SettingsAuth } from '@/data/settingsApi'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'

const props = withDefaults(
  defineProps<{
    client: AdultClient
    householdId: string
    membershipId: string
    /** 'display': Settings on a tablet (no OAuth). 'browser': Manage household. */
    surface: 'display' | 'browser'
    /** The open Settings PIN session on a display, which authorises the changes; null in a browser. */
    pin?: SettingsAuth | null
    headingLevel?: 2 | 3
    api?: CalendarSettingsApi
    /** Bump to read the list again (e.g. after Manage household finished an OAuth connection). */
    reloadKey?: number
    /** Opens the provider's consent page (tests). */
    navigate?: (url: string) => void
  }>(),
  { headingLevel: 2, reloadKey: 0, pin: null },
)

const emit = defineEmits<{ busy: [boolean] }>()

const api = props.api ?? createCalendarSettingsApi()
const navigate = props.navigate ?? ((url: string) => window.location.assign(url))

const PROVIDER_LABEL: Record<MyConnection['provider'], string> = {
  ics: 'Calendar link',
  google: 'Google',
  microsoft: 'Microsoft',
}
const MANAGE_URL = 'roost.cmrd.dev/manage'

const connections = shallowRef<MyConnection[]>([])
const people = shallowRef<CalendarPerson[]>([])
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const icsUrl = ref('')
const icsError = ref<string | null>(null)
const notConfigured = ref<Array<'google' | 'microsoft'>>([])
/** The calendar being shown that still needs a person. */
const choosingFor = ref<string | null>(null)
const confirmDisconnectId = ref<string | null>(null)

const headingTag = computed(() => `h${props.headingLevel}`)
const subTag = computed(() => `h${props.headingLevel + 1}`)
const titleId = useId()
const root = useTemplateRef<HTMLElement>('root')

watch(busy, (value) => emit('busy', value))
// A host counting on `busy` must not be left waiting when the section goes away mid-change.
onBeforeUnmount(() => {
  if (busy.value) emit('busy', false)
})

// ─── The three changes, through whichever authority this surface has ─────
/** A refusal points at what this surface authorises with: the Settings PIN, or the email sign-in. */
const failureMessage = (e: unknown, context: 'ics' | 'oauth' = 'ics') => calendarConnectMessage(e, context, props.pin ? 'pin' : 'account')
const connectIcsCall = (url: string) =>
  props.pin ? api.connectIcsWithPin(props.client, props.householdId, props.pin, url) : api.connectIcs(props.client, props.householdId, url)
const setSelectionCall = (selectionId: string, visible: boolean, assignee: Assignee | null) =>
  props.pin
    ? api.setSelectionWithPin(props.client, props.pin, selectionId, visible, assignee)
    : api.setSelection(props.client, selectionId, visible, assignee)
const disconnectCall = (connectionId: string) =>
  props.pin ? api.disconnectWithPin(props.client, props.pin, connectionId) : api.disconnect(props.client, connectionId)

/** Only the latest load's answer is shown (a slower earlier one is ignored). */
let loadSeq = 0

async function load(): Promise<void> {
  if (isDemo) return
  const mine = ++loadSeq
  loading.value = true
  try {
    const [rows, everyone] = await Promise.all([
      api.listMyConnections(props.client, props.householdId, props.membershipId),
      api.listPeople(props.client, props.householdId),
    ])
    if (mine !== loadSeq) return
    connections.value = rows
    people.value = everyone
    loaded.value = true
    error.value = null
  } catch (e) {
    if (mine !== loadSeq) return
    error.value = `Couldn’t load your calendars. ${failureMessage(e)}`
  } finally {
    if (mine === loadSeq) loading.value = false
  }
}

async function focusAfterChange(selector: string | null): Promise<void> {
  await nextTick()
  const target = (selector && root.value?.querySelector<HTMLElement>(selector)) || root.value?.querySelector<HTMLElement>('[data-calendars-notice]')
  target?.focus()
}

watch(
  () => [props.client, props.householdId, props.membershipId, props.reloadKey] as const,
  () => {
    choosingFor.value = null
    confirmDisconnectId.value = null
    void load()
  },
  { immediate: true },
)

async function act(work: () => Promise<void>, context: 'ics' | 'oauth' = 'ics'): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  error.value = null
  notice.value = null
  try {
    await work()
    return true
  } catch (e) {
    error.value = failureMessage(e, context)
    return false
  } finally {
    busy.value = false
  }
}

// ─── Connect ─────────────────────────────────────────────────────────────
async function connectLink(): Promise<void> {
  const url = icsUrl.value.trim()
  icsError.value = null
  if (!url) {
    icsError.value = 'Paste your calendar’s link first.'
    return
  }
  if (busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  let connectionId: string
  let alreadyConnected: boolean
  try {
    const result = await connectIcsCall(url)
    icsUrl.value = ''
    connectionId = result.connectionId
    alreadyConnected = result.alreadyConnected
    notice.value = result.alreadyConnected
      ? 'That calendar is already connected.'
      : `Connected “${result.name}”. Choose whose calendar it is, then show it on the displays.`
  } catch (e) {
    icsError.value = failureMessage(e)
    return
  } finally {
    busy.value = false
  }
  await load()
  // A new connection: its heading. Already connected (or not in the list): the notice says what happened.
  const listed = connections.value.some((c) => c.id === connectionId)
  await focusAfterChange(listed && !alreadyConnected ? `[data-connection-heading="${CSS.escape(connectionId)}"]` : null)
}

async function connectProvider(provider: 'google' | 'microsoft'): Promise<void> {
  if (props.surface !== 'browser' || notConfigured.value.includes(provider)) return
  await act(async () => {
    const result = await api.startOAuth(props.client, props.householdId, provider)
    if ('notConfigured' in result) {
      if (!notConfigured.value.includes(provider)) notConfigured.value = [...notConfigured.value, provider]
      return
    }
    // Only ever leave for a provider's https consent page.
    if (!/^https:\/\//i.test(result.url)) throw new Error('unexpected consent URL')
    navigate(result.url)
  }, 'oauth')
}

// ─── Show and assign ─────────────────────────────────────────────────────
const personKey = (a: Assignee | null) => (a ? `${a.type}:${a.id}` : '')
const personFor = (a: Assignee | null) => people.value.find((p) => personKey(p) === personKey(a)) ?? null

function replaceCalendar(connectionId: string, next: MyCalendar): void {
  connections.value = connections.value.map((c) =>
    c.id === connectionId ? { ...c, calendars: c.calendars.map((cal) => (cal.id === next.id ? next : cal)) } : c,
  )
}

async function save(connection: MyConnection, calendar: MyCalendar, visible: boolean, assignee: Assignee | null): Promise<void> {
  const ok = await act(() => setSelectionCall(calendar.id, visible, assignee))
  if (!ok) return
  replaceCalendar(connection.id, { ...calendar, visible, assignee })
  if (choosingFor.value === calendar.id) choosingFor.value = null
}

async function toggleVisible(connection: MyConnection, calendar: MyCalendar): Promise<void> {
  if (busy.value || calendar.gone) return
  if (calendar.visible) {
    if (choosingFor.value === calendar.id) choosingFor.value = null
    await save(connection, calendar, false, calendar.assignee)
    return
  }
  if (!calendar.assignee || !personFor(calendar.assignee)) {
    // A shown calendar belongs to exactly one person: ask for them first.
    choosingFor.value = calendar.id
    error.value = null
    notice.value = null
    return
  }
  await save(connection, calendar, true, calendar.assignee)
}

async function assign(connection: MyConnection, calendar: MyCalendar, person: CalendarPerson): Promise<void> {
  const assignee: Assignee = { type: person.type, id: person.id }
  const visible = calendar.visible || choosingFor.value === calendar.id
  if (personKey(calendar.assignee) === personKey(assignee) && visible === calendar.visible) return
  await save(connection, calendar, visible, assignee)
}

/** Arrow keys move through a calendar's people like a radio group. */
function onPersonKeydown(e: KeyboardEvent, connection: MyConnection, calendar: MyCalendar, index: number): void {
  const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown'
  const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  if ((!isNext && !isPrev) || people.value.length === 0) return
  e.preventDefault()
  // While a change saves, the selection (and so focus) stays put.
  if (busy.value) return
  const nextIndex = (index + (isNext ? 1 : -1) + people.value.length) % people.value.length
  const group = (e.currentTarget as HTMLElement).parentElement
  ;(group?.children[nextIndex] as HTMLElement | undefined)?.focus()
  void assign(connection, calendar, people.value[nextIndex]!)
}

function personTabindex(calendar: MyCalendar, index: number): 0 | -1 {
  const selected = people.value.findIndex((p) => personKey(p) === personKey(calendar.assignee))
  return index === (selected === -1 ? 0 : selected) ? 0 : -1
}

// ─── Disconnect ──────────────────────────────────────────────────────────
async function disconnect(connection: MyConnection): Promise<void> {
  const ok = await act(() => disconnectCall(connection.id))
  if (!ok) return
  confirmDisconnectId.value = null
  connections.value = connections.value.filter((c) => c.id !== connection.id)
  notice.value = `Disconnected ${connection.label}. Its events no longer show on your displays.`
  await focusAfterChange(null)
  await load()
}

function statusText(connection: MyConnection): string {
  if (connection.status === 'auth_expired') return 'Needs reconnecting: disconnect it, then connect it again.'
  if (connection.status === 'unreachable') return 'Couldn’t be reached lately. Check that the calendar still exists.'
  return 'Connected'
}
</script>

<template>
  <section ref="root" :aria-labelledby="titleId" data-testid="calendars-section" class="flex flex-col gap-5">
    <component :is="headingTag" :id="titleId" :class="headingLevel === 2 ? 'text-[32px]' : 'text-[26px]'" class="font-semibold text-ink">
      Calendars
    </component>
    <p class="text-[18px] text-ink-3">
      Connect your calendars and choose whose events each one holds. Today’s events show on your displays; Roost Family
      never saves them.
    </p>

    <p v-if="isDemo" class="text-[18px] text-ink-2">Calendars aren’t available in the demo.</p>

    <template v-else>
      <p v-if="notice" role="status" tabindex="-1" data-calendars-notice class="text-[18px] font-medium text-green-deep outline-none">{{ notice }}</p>
      <p v-if="error" role="alert" class="text-[18px] text-warn-ink">{{ error }}</p>

      <!-- Connect a calendar link -->
      <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <component :is="subTag" class="text-[22px] font-semibold text-ink">Connect a calendar link</component>
        <p class="text-[18px] text-ink-2">
          Paste your calendar’s secret iCal address. Anyone with that link can see the calendar, so Roost Family keeps it
          encrypted and never shows it again.
        </p>
        <ul class="flex list-disc flex-col gap-1 pl-6 text-[18px] text-ink-3" aria-label="Where to find the link">
          <li><strong class="font-semibold text-ink-2">Google Calendar</strong> (on a computer): Settings → your calendar → Integrate calendar → Secret address in iCal format.</li>
          <li><strong class="font-semibold text-ink-2">Outlook</strong>: Settings → Calendar → Shared calendars → Publish a calendar → the ICS link.</li>
          <li><strong class="font-semibold text-ink-2">iCloud</strong>: in Calendar, share the calendar → Public Calendar → copy the link.</li>
        </ul>
        <form class="flex flex-col gap-3" @submit.prevent="connectLink">
          <RInput v-model="icsUrl" label="Calendar link" type="url" placeholder="https://… or webcal://…" autocomplete="off" />
          <p v-if="icsError" role="alert" data-testid="ics-error" class="text-[18px] text-warn-ink">{{ icsError }}</p>
          <div>
            <RButton type="submit" :aria-disabled="busy || undefined" class="aria-disabled:cursor-progress">
              {{ busy ? 'Connecting…' : 'Connect link' }}
            </RButton>
          </div>
        </form>
      </div>

      <!-- Google and Microsoft -->
      <div class="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface px-6 py-5">
        <component :is="subTag" class="text-[22px] font-semibold text-ink">Google or Microsoft account</component>
        <div class="flex flex-wrap gap-3">
          <RButton
            v-for="provider in (['google', 'microsoft'] as const)"
            :key="provider"
            variant="secondary"
            :data-testid="`connect-${provider}`"
            :disabled="surface !== 'browser'"
            :aria-disabled="surface === 'browser' && (busy || notConfigured.includes(provider)) ? 'true' : undefined"
            :class="notConfigured.includes(provider) && 'opacity-50 aria-disabled:cursor-not-allowed'"
            @click="connectProvider(provider)"
          >
            {{ provider === 'google' ? 'Connect Google' : 'Connect Microsoft' }}<template v-if="notConfigured.includes(provider)"> — Not set up yet</template>
          </RButton>
        </div>
        <p v-if="surface !== 'browser'" class="text-[18px] text-ink-2">
          Connect Google or Microsoft from Manage household on your phone or computer: <strong class="font-semibold">{{ MANAGE_URL }}</strong>
        </p>
      </div>

      <!-- My connections -->
      <p v-if="loading && !loaded" role="status" class="text-[20px] text-ink-2">Loading your calendars…</p>
      <p v-else-if="loaded && connections.length === 0" class="text-[18px] text-ink-2">You haven’t connected a calendar yet.</p>

      <ul v-if="connections.length" class="flex flex-col gap-4" aria-label="Your connected calendars">
        <li
          v-for="connection in connections"
          :key="connection.id"
          :data-testid="`connection-${connection.id}`"
          class="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface px-6 py-5"
        >
          <div class="flex flex-wrap items-start gap-4">
            <div class="flex min-w-0 flex-1 basis-48 flex-col">
              <component
                :is="subTag"
                tabindex="-1"
                :data-connection-heading="connection.id"
                class="text-[22px] font-semibold break-words text-ink outline-none"
              >
                {{ connection.label }}
              </component>
              <span class="text-[18px]" :class="connection.status === 'ok' ? 'text-ink-3' : 'font-medium text-warn-ink'">
                {{ PROVIDER_LABEL[connection.provider] }} · {{ statusText(connection) }}
              </span>
            </div>
            <RButton variant="ghost" :aria-disabled="busy || undefined" @click="!busy && (confirmDisconnectId = connection.id)">Disconnect</RButton>
          </div>

          <div v-if="confirmDisconnectId === connection.id" class="flex flex-col gap-3 border-t border-line pt-3">
            <p class="text-[20px] text-ink">Disconnect {{ connection.label }}? Its events stop showing on your displays.</p>
            <div class="flex flex-wrap gap-3">
              <RButton variant="secondary" :aria-disabled="busy || undefined" @click="!busy && (confirmDisconnectId = null)">Cancel</RButton>
              <RButton variant="danger" :aria-disabled="busy || undefined" class="aria-disabled:cursor-progress" @click="disconnect(connection)">
                Disconnect {{ connection.label }}
              </RButton>
            </div>
          </div>

          <ul class="flex flex-col gap-4" :aria-label="`Calendars in ${connection.label}`">
            <li
              v-for="calendar in connection.calendars"
              :key="calendar.id"
              :data-testid="`calendar-${calendar.id}`"
              class="flex flex-col gap-3 border-t border-line pt-4"
            >
              <div class="flex flex-wrap items-center gap-4">
                <div class="flex min-w-0 flex-1 basis-40 flex-col">
                  <span class="text-[20px] font-medium break-words text-ink">{{ calendar.name }}</span>
                  <span v-if="calendar.gone" class="text-[18px] text-warn-ink">No longer in this account</span>
                  <span v-else-if="personFor(calendar.assignee)" class="text-[18px] text-ink-3">{{ personFor(calendar.assignee)!.name }}’s calendar</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="calendar.visible"
                  :aria-label="`Show ${calendar.name} on displays`"
                  :aria-disabled="busy || calendar.gone || undefined"
                  :data-testid="`visible-${calendar.id}`"
                  class="flex min-h-[44px] items-center gap-3 rounded-[var(--radius-control)] px-2 text-[18px] font-medium text-ink aria-disabled:cursor-not-allowed focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                  :class="calendar.gone && 'opacity-50'"
                  @click="toggleVisible(connection, calendar)"
                >
                  <span
                    class="relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors"
                    :class="calendar.visible ? 'bg-green-deep' : 'bg-ink-3'"
                    aria-hidden="true"
                  >
                    <span class="absolute top-1 h-6 w-6 rounded-full bg-surface transition-[left]" :class="calendar.visible ? 'left-7' : 'left-1'" />
                  </span>
                  {{ calendar.visible ? 'Shown' : 'Hidden' }}
                </button>
              </div>

              <p v-if="choosingFor === calendar.id" role="status" data-testid="choose-person" class="text-[18px] font-medium text-orange-deep">
                Choose whose calendar this is to show it.
              </p>
              <div
                v-if="!calendar.gone && people.length"
                role="radiogroup"
                :aria-label="`Whose calendar is ${calendar.name}?`"
                class="flex flex-wrap gap-2"
              >
                <button
                  v-for="(person, i) in people"
                  :key="personKey(person)"
                  type="button"
                  role="radio"
                  :aria-checked="personKey(calendar.assignee) === personKey(person)"
                  :tabindex="personTabindex(calendar, i)"
                  :aria-disabled="busy || undefined"
                  :data-testid="`assign-${calendar.id}-${person.id}`"
                  class="flex min-h-[44px] items-center gap-2 rounded-full py-1 pr-4 pl-1 text-[18px] font-medium aria-disabled:cursor-progress focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
                  :class="personKey(calendar.assignee) === personKey(person) ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
                  @click="assign(connection, calendar, person)"
                  @keydown="onPersonKeydown($event, connection, calendar, i)"
                >
                  <RAvatar :name="person.name" :color="person.color" :size="36" decorative />
                  {{ person.name }}
                </button>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>
