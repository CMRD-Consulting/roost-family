<script setup lang="ts">
/**
 * Log a medicine dose (spec §7.4, §11.4): child, one of that child's medicines, time, who gave it (required)
 * and an optional note. Early and over-max warnings need confirmation; so does logging without a live
 * check against other adults' doses. Never blocked, never any dosing guidance.
 */
import { computed, ref, watch } from 'vue'
import { newId, type LogCommand } from '@/data/logCommands'
import { checkDose } from '@/domain/medicine'
import { NeedsOfflineDoseConfirmation } from '@/stores/logStore'
import RButton from '@/ui/RButton.vue'
import RChips from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import RTimeStepper from '@/ui/RTimeStepper.vue'
import ChildPicker from './ChildPicker.vue'
import SheetError from './SheetError.vue'
import SheetLabel from './SheetLabel.vue'
import WhoRow from './WhoRow.vue'
import {
  attributionFor, defaultChildId, doseWarningMessages, eligibleChildren, medicineScheduleLabel,
} from './logSheetModel'
import { useLogSheet, type SaveResult } from './useLogSheet'
import { useSheetTime } from './useSheetTime'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: SaveResult] }>()

const LOOKBACK_MS = 24 * 3_600_000

const { view, identity, busy, error, submit, clearError } = useLogSheet()

const { now, at, max, adjust, reset: resetTime, catchUp } = useSheetTime(() => minAt.value)
const childId = ref<string | null>(null)
const medicineId = ref<string | null>(null)
const who = ref<string | null>(null)
const note = ref('')
/** The dose waiting for "Log anyway" because other adults' doses couldn't be checked. */
const pendingOffline = ref<LogCommand | null>(null)

const tz = computed(() => view.value?.household.timeZone ?? 'UTC')
const children = computed(() => (view.value ? eligibleChildren(view.value, 'medicine', now.value) : []))
const child = computed(() => children.value.find((c) => c.id === childId.value) ?? null)
const medicines = computed(() => (view.value && child.value ? view.value.medicines.filter((m) => m.childId === child.value!.id) : []))
const medicine = computed(() => medicines.value.find((m) => m.id === medicineId.value) ?? null)
const medicineOptions = computed(() =>
  medicines.value.map((m) => ({ value: m.id, label: m.name, detail: medicineScheduleLabel(m) })),
)
const minAt = computed(() => new Date(now.value.getTime() - LOOKBACK_MS).toISOString())

const warnings = computed(() =>
  view.value && medicine.value ? checkDose(medicine.value, view.value.doses, new Date(at.value)) : [],
)
const warningMessages = computed(() => (medicine.value ? doseWarningMessages(warnings.value, medicine.value) : []))

// A different child has a different medicine list; never carry a pick across.
watch(childId, () => {
  if (medicineId.value !== null && !medicines.value.some((m) => m.id === medicineId.value)) medicineId.value = null
})

const warningKinds = computed(() => warnings.value.map((w) => w.kind).join(','))
/**
 * The warning kinds the adult is confirming: taken when the save button's label last changed and whenever the
 * adult changes what is being logged. Warnings that change without either (the clock moving on, another
 * display's dose arriving) must be looked at again before a tap confirms them.
 */
const acknowledgedWarningKinds = ref('')
const warningsChanged = ref(false)

function acknowledgeWarnings(): void {
  acknowledgedWarningKinds.value = warningKinds.value
}

function onTimeAdjusted(value: string): void {
  adjust(value)
  acknowledgeWarnings()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetTime()
    medicineId.value = null
    who.value = null
    note.value = ''
    pendingOffline.value = null
    warningsChanged.value = false
    clearError()
    childId.value = defaultChildId(children.value)
    acknowledgeWarnings()
  },
  { immediate: true },
)

/** During Sitter Mode the sitter is who gave it, so no adult has to be picked. */
const sitter = computed(() => view.value?.activeSitterSession ?? null)
const whoChosen = computed(() => who.value !== null || sitter.value !== null)
const canSave = computed(
  () => !busy.value && child.value !== null && medicine.value !== null && whoChosen.value,
)
const saveLabel = computed(() => (warnings.value.length > 0 ? 'Confirm and save' : 'Save'))
watch([saveLabel, childId, medicineId], acknowledgeWarnings)

async function send(cmd: LogCommand, confirmOffline: boolean): Promise<void> {
  let result: SaveResult | null
  try {
    result = await submit(cmd, { confirmOffline })
  } catch (e) {
    if (!(e instanceof NeedsOfflineDoseConfirmation)) throw e
    pendingOffline.value = cmd
    return
  }
  if (result) {
    pendingOffline.value = null
    emit('saved', result)
    emit('close')
  }
}

async function save(): Promise<void> {
  catchUp()
  if (!view.value || !child.value || !medicine.value || !whoChosen.value || !canSave.value) return
  if (warningKinds.value !== acknowledgedWarningKinds.value) {
    // Not what the adult was looking at when they tapped: show the new warnings and wait for another tap.
    acknowledgeWarnings()
    warningsChanged.value = true
    return
  }
  warningsChanged.value = false
  const attribution = attributionFor(identity.value, who.value, view.value.members, sitter.value)
  await send(
    {
      kind: 'dose.add',
      householdId: view.value.household.id,
      entry: {
        id: newId(),
        childId: child.value.id,
        medicineId: medicine.value.id,
        at: at.value,
        loggedByName: attribution.loggedByName,
        loggedOffline: false,
        voidedAt: null,
        voidReason: null,
        conflictAcknowledgedAt: null,
        createdAt: new Date().toISOString(),
        note: note.value.trim() || null,
        warningsConfirmed: warnings.value.map((w) => w.kind),
        sitterSessionId: attribution.sitterSessionId,
      },
      attribution,
    },
    false,
  )
}

async function logAnyway(): Promise<void> {
  if (!pendingOffline.value || busy.value) return
  await send(pendingOffline.value, true)
}
</script>

<template>
  <RSheet title="Medicine" :open="open" @close="emit('close')">
    <div v-if="view" class="flex flex-col gap-6">
      <p class="text-[18px] text-ink-3">Timing only — follow the label or your doctor for amounts.</p>

      <template v-if="pendingOffline">
        <div role="alert" class="flex items-center gap-4 rounded-[var(--radius-control)] bg-surface-2 px-5 py-4 text-ink">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 text-ink-3"
            aria-hidden="true"
          >
            <path d="M2 2l20 20M5 12a10 10 0 0 1 3-2.5M12 12a5 5 0 0 1 4 1.5M12 18h.01" />
          </svg>
          <p class="text-[22px] leading-snug">Can't check whether another adult gave a dose. Log anyway?</p>
        </div>
      </template>

      <template v-else>
        <ChildPicker v-model="childId" :children="children">
          <template #empty>
            <p class="text-[22px] text-ink-2">No medicines yet. Add them in Settings → Medicines.</p>
          </template>
        </ChildPicker>

        <template v-if="child">
          <div class="flex flex-col gap-2">
            <SheetLabel>Medicine</SheetLabel>
            <RChips v-model="medicineId" :options="medicineOptions" label="Medicine" />
          </div>
          <div class="flex flex-col gap-2">
            <SheetLabel>Time given</SheetLabel>
            <RTimeStepper :model-value="at" :min="minAt" :max="max" :time-zone="tz" @update:model-value="onTimeAdjusted" />
          </div>

          <p v-if="warningsChanged" role="alert" data-testid="warnings-changed" class="text-[22px] font-semibold text-warn-ink">
            Warnings changed — review and confirm.
          </p>
          <div
            v-if="warningMessages.length > 0"
            data-testid="dose-warnings"
            aria-live="polite"
            class="flex gap-4 rounded-[var(--radius-control)] bg-orange-tint px-5 py-4 text-warn-ink"
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="mt-0.5 shrink-0"
              aria-hidden="true"
            >
              <path d="M12 3l10 18H2z" />
              <path d="M12 10v4M12 17.5v.5" />
            </svg>
            <ul class="flex flex-col gap-2 text-[22px] leading-snug">
              <li v-for="message in warningMessages" :key="message">{{ message }}</li>
            </ul>
          </div>

          <WhoRow v-model="who" :members="view.members" :required="true" :sitter="sitter" />
          <RInput v-model="note" label="Note (optional)" placeholder="e.g. 5 ml" :maxlength="200" />
        </template>
      </template>

      <SheetError :message="error" />
    </div>

    <template #footer>
      <div v-if="pendingOffline" class="flex gap-3">
        <RButton variant="secondary" tier="moment" class="flex-1" :disabled="busy" @click="pendingOffline = null">
          Cancel
        </RButton>
        <RButton tier="moment" class="flex-[2]" :disabled="busy" @click="logAnyway">Log anyway</RButton>
      </div>
      <RButton v-else tier="moment" class="w-full" :disabled="!canSave" @click="save">{{ saveLabel }}</RButton>
    </template>
  </RSheet>
</template>
