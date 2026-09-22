<script setup lang="ts">
/**
 * To-do tab (kitchen spec §4.2): filter chips (All · Family · each adult) with their open counts, an add
 * field that takes the current filter's assignee, and rows grouped Overdue · Today · Later · No date with
 * the last 24 h of completions at the bottom. Tapping a row's body opens the edit sheet. No PIN (§2).
 */
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { newId, type LogCommand, type TaskFields } from '@/data/logCommands'
import type { Task } from '@/data/snapshot'
import SheetError from '@/features/logs/SheetError.vue'
import { useLogSheet } from '@/features/logs/useLogSheet'
import { householdDate } from '@/domain/time'
import RAvatar from '@/ui/RAvatar.vue'
import RButton from '@/ui/RButton.vue'
import RInput from '@/ui/RInput.vue'
import TaskSheet from './TaskSheet.vue'
import {
  ALL_FILTER, EMPTY_TODO_MESSAGE, MAX_TASK_TEXT, assigneeForFilter, cleanTaskText, dueLabel, todoFilters,
  todoGroups, type TodoFilter,
} from './todoModel'

/** The Kitchen screen holds Night Mode off while this tab's sheet is open (design §7.7). */
const emit = defineEmits<{ 'sheet-open': [open: boolean] }>()

const { view, displayId, error, submit, clearError } = useLogSheet()
// Only the 24-hour "done recently" window and the household's date depend on the clock.
const now = useNow(60_000)

const filter = ref<TodoFilter>(ALL_FILTER)
const draft = ref('')
/** The to-do being edited; `'new'` while the sheet is adding one. */
const editing = ref<Task | 'new' | null>(null)

const members = computed(() => view.value?.members ?? [])
const today = computed(() => householdDate(now.value, view.value?.household.timeZone ?? 'UTC'))
const filters = computed(() => todoFilters(view.value?.tasks, members.value))
const groups = computed(() => todoGroups(view.value?.tasks, filter.value, today.value, now.value))

const sheetOpen = computed(() => editing.value !== null)
watch(sheetOpen, (open) => emit('sheet-open', open), { immediate: true })

/** The membership a row is assigned to, resolved against every member so a caregiver's row still shows one. */
function assignee(task: Task) {
  return members.value.find((member) => member.id === task.assignedMembershipId) ?? null
}

async function run(cmd: LogCommand): Promise<boolean> {
  return (await submit(cmd)) !== null
}

function select(value: TodoFilter): void {
  filter.value = value
  clearError()
}

async function add(): Promise<void> {
  const text = cleanTaskText(draft.value)
  if (!view.value || text.length === 0) return
  draft.value = ''
  const task: Task = {
    id: newId(),
    text,
    assignedMembershipId: assigneeForFilter(filter.value),
    dueOn: null,
    createdAt: new Date().toISOString(),
    doneAt: null,
  }
  const ok = await run({ kind: 'task.add', householdId: view.value.household.id, task, displayId: displayId.value })
  if (!ok && draft.value === '') draft.value = text
}

async function toggle(task: Task): Promise<void> {
  if (!view.value) return
  await run({
    kind: 'task.check',
    householdId: view.value.household.id,
    taskId: task.id,
    doneAt: task.doneAt === null ? new Date().toISOString() : null,
    previousDoneAt: task.doneAt,
  })
}

async function saveSheet(fields: TaskFields): Promise<void> {
  const target = editing.value
  editing.value = null
  if (!view.value || target === null) return
  if (target === 'new') {
    draft.value = ''
    const task: Task = { id: newId(), ...fields, createdAt: new Date().toISOString(), doneAt: null }
    await run({ kind: 'task.add', householdId: view.value.household.id, task, displayId: displayId.value })
    return
  }
  await run({
    kind: 'task.update',
    householdId: view.value.household.id,
    taskId: target.id,
    ...fields,
    previous: { text: target.text, assignedMembershipId: target.assignedMembershipId, dueOn: target.dueOn },
  })
}

async function deleteSheet(): Promise<void> {
  const target = editing.value
  editing.value = null
  if (!view.value || target === null || target === 'new') return
  await run({ kind: 'task.delete', householdId: view.value.household.id, task: target, displayId: displayId.value })
}

/** Opens the sheet on a new to-do, carrying whatever has been typed and the filter's assignee. */
function addWithDetails(): void {
  editing.value = 'new'
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3" role="group" aria-label="To-do filters">
      <button
        v-for="chip in filters"
        :key="chip.value"
        type="button"
        data-testid="todo-filter"
        :aria-pressed="chip.value === filter"
        class="flex min-h-[60px] items-center gap-3 rounded-[var(--radius-control)] px-5 text-[22px] font-medium focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        :class="chip.value === filter ? 'bg-ink text-surface' : 'bg-surface-2 text-ink'"
        @click="select(chip.value)"
      >
        <RAvatar v-if="chip.color" :name="chip.label" :color="chip.color" :size="34" decorative />
        <span>{{ chip.label }}</span>
        <span class="text-[18px]" :class="chip.value === filter ? 'text-surface' : 'text-ink-2'">{{ chip.count }}</span>
      </button>
    </div>

    <form class="flex items-end gap-3" @submit.prevent="add">
      <RInput v-model="draft" data-testid="todo-add" label="Add a to-do" :maxlength="MAX_TASK_TEXT" class="flex-1" />
      <RButton type="submit" tier="moment" :disabled="cleanTaskText(draft).length === 0">Add</RButton>
      <RButton variant="secondary" tier="moment" @click="addWithDetails">Add with a date</RButton>
    </form>

    <SheetError :message="error" />

    <p v-if="groups.length === 0" class="text-[24px] text-ink-2">{{ EMPTY_TODO_MESSAGE }}</p>
    <section v-for="group in groups" :key="group.id" data-testid="todo-group" class="flex flex-col gap-2">
      <h3 class="text-[18px] font-semibold uppercase tracking-[0.08em] text-ink-2">{{ group.label }}</h3>
      <ul class="flex flex-col rounded-[var(--radius-card)] bg-surface" :aria-label="group.label">
        <li
          v-for="task in group.tasks"
          :key="task.id"
          data-testid="todo-item"
          class="flex items-center gap-2 border-b border-surface-2 px-2 last:border-b-0"
        >
          <button
            type="button"
            role="checkbox"
            :aria-checked="task.doneAt !== null"
            :aria-label="`Done: ${task.text}`"
            class="flex min-h-[60px] min-w-[60px] items-center justify-center"
            @click="toggle(task)"
          >
            <span
              aria-hidden="true"
              class="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border-2 text-[16px] font-bold text-surface"
              :class="task.doneAt !== null ? 'border-green-deep bg-green-deep' : 'border-ink-3 bg-transparent'"
            >
              {{ task.doneAt !== null ? '✓' : '' }}
            </span>
          </button>
          <button
            type="button"
            :aria-label="`Edit ${task.text}`"
            class="flex min-h-[60px] flex-1 items-center gap-3 px-2 text-left"
            @click="editing = task"
          >
            <RAvatar
              v-if="assignee(task)"
              :name="assignee(task)!.displayName"
              :color="assignee(task)!.color"
              :size="36"
            />
            <span v-else class="rounded-full bg-surface-2 px-3 py-1 text-[16px] font-medium text-ink-2">Family</span>
            <span class="text-[24px]" :class="task.doneAt !== null ? 'text-ink-3 line-through' : 'text-ink'">
              {{ task.text }}
            </span>
            <span
              v-if="dueLabel(task.dueOn, today)"
              class="ml-auto shrink-0 text-[18px] font-medium"
              :class="group.id === 'overdue' ? 'text-warn-ink' : 'text-ink-2'"
            >
              {{ dueLabel(task.dueOn, today) }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <TaskSheet
      :open="editing !== null"
      :task="editing === 'new' ? null : editing"
      :members="members"
      :today="today"
      :default-assignee="assigneeForFilter(filter)"
      :initial-text="cleanTaskText(draft)"
      @close="editing = null"
      @save="saveSheet"
      @delete="deleteSheet"
    />
  </div>
</template>
