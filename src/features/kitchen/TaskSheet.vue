<script setup lang="ts">
/**
 * Add or edit a to-do (kitchen spec §4.2): text, an assignee (Family or one adult), a due date, and — when
 * editing — Delete, which takes a second confirming tap (§2). The sheet only reports what was chosen; the
 * To-do tab turns that into `task.add` / `task.update` / `task.delete`.
 */
import { computed, ref, watch } from 'vue'
import type { TaskFields } from '@/data/logCommands'
import type { Member, Task } from '@/data/snapshot'
import type { HouseholdDate } from '@/domain/types'
import RButton from '@/ui/RButton.vue'
import RChips, { type ChipOption } from '@/ui/RChips.vue'
import RInput from '@/ui/RInput.vue'
import RSheet from '@/ui/RSheet.vue'
import { FAMILY_FILTER, MAX_TASK_TEXT, PICK_A_DATE, assignableMembers, cleanTaskText, dueChoiceFor, dueChoices } from './todoModel'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The to-do being edited, or null to add one. */
    task: Task | null
    members: Member[]
    /** The household's own date, so "Today" means today here. */
    today: HouseholdDate
    /** What a new to-do starts with (the current filter's assignee, and anything already typed). */
    defaultAssignee?: string | null
    initialText?: string
  }>(),
  { defaultAssignee: null, initialText: '' },
)
const emit = defineEmits<{ close: []; save: [fields: TaskFields]; delete: [] }>()

const text = ref('')
/** `family` or a membership id — RChips holds a string, and Family is a choice, not an empty one. */
const assignee = ref<string | null>(FAMILY_FILTER)
const dueChoice = ref<string | null>('none')
/** The date behind "Pick a date", as the native date field's `yyyy-mm-dd`. */
const pickedDate = ref('')
const confirmingDelete = ref(false)

const choices = computed(() => dueChoices(props.today))

const assigneeOptions = computed<ChipOption[]>(() => [
  { value: FAMILY_FILTER, label: 'Family' },
  ...assignableMembers(props.members).map((member) => ({ value: member.id, label: member.displayName })),
])
const dueOptions = computed<ChipOption[]>(() => choices.value.map((c) => ({ value: c.value, label: c.label })))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    confirmingDelete.value = false
    const task = props.task
    text.value = task?.text ?? props.initialText
    assignee.value = (task ? task.assignedMembershipId : props.defaultAssignee) ?? FAMILY_FILTER
    const dueOn = task?.dueOn ?? null
    dueChoice.value = dueChoiceFor(dueOn, props.today)
    pickedDate.value = dueChoice.value === PICK_A_DATE && dueOn !== null ? dueOn : ''
  },
  { immediate: true },
)

/** The date the chips currently mean: a fixed choice, or whatever the date field holds. */
const dueOn = computed<HouseholdDate | null>(() => {
  if (dueChoice.value === PICK_A_DATE) return pickedDate.value === '' ? null : pickedDate.value
  return choices.value.find((c) => c.value === dueChoice.value)?.dueOn ?? null
})

const canSave = computed(() => cleanTaskText(text.value).length > 0)

function save(): void {
  const clean = cleanTaskText(text.value)
  if (clean.length === 0) return
  emit('save', {
    text: clean,
    assignedMembershipId: assignee.value === FAMILY_FILTER ? null : assignee.value,
    dueOn: dueOn.value,
  })
}

function remove(): void {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  confirmingDelete.value = false
  emit('delete')
}
</script>

<template>
  <RSheet :title="task ? 'Edit to-do' : 'New to-do'" :open="open" @close="emit('close')">
    <form class="flex flex-col gap-6" @submit.prevent="save">
      <RInput v-model="text" data-testid="task-text" label="To-do" :maxlength="MAX_TASK_TEXT" />

      <div class="flex flex-col gap-3">
        <p class="text-[18px] font-medium text-ink-2">Who</p>
        <RChips v-model="assignee" label="Who" :options="assigneeOptions" />
      </div>

      <div class="flex flex-col gap-3">
        <p class="text-[18px] font-medium text-ink-2">Due</p>
        <RChips v-model="dueChoice" label="Due" :options="dueOptions" />
        <label v-if="dueChoice === PICK_A_DATE" class="flex flex-col gap-2">
          <span class="text-[18px] font-medium text-ink-2">Date</span>
          <input
            v-model="pickedDate"
            data-testid="task-date"
            type="date"
            class="min-h-[60px] rounded-[var(--radius-control)] border-2 border-ink-3 bg-surface px-4 text-[22px] text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-orange-deep"
          />
        </label>
      </div>

      <RButton
        v-if="task"
        variant="danger"
        tier="moment"
        class="self-start"
        data-testid="task-delete"
        @click="remove"
      >
        {{ confirmingDelete ? 'Delete — tap again' : 'Delete' }}
      </RButton>
    </form>

    <template #footer>
      <RButton tier="moment" class="w-full" :disabled="!canSave" @click="save">Save</RButton>
    </template>
  </RSheet>
</template>
