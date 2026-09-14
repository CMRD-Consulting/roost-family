import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Member, SnapshotChild } from '@/data/snapshot'
import ChildPicker from './ChildPicker.vue'
import WhoRow from './WhoRow.vue'

/** Mount a `defineModel`-based component, wiring modelValue <-> update:modelValue like a real v-model. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountModel(Component: any, modelValue: unknown, props: Record<string, unknown> = {}): any {
  const wrapper: any = mount(Component, {
    props: { modelValue, 'onUpdate:modelValue': (v: unknown) => wrapper.setProps({ modelValue: v }), ...props },
    attachTo: document.body,
  })
  return wrapper
}

const children = [
  { id: 'c1', name: 'Ivy', color: '#653437' },
  { id: 'c2', name: 'Theo', color: '#2C7F8C' },
  { id: 'c3', name: 'June', color: '#4F6B2C' },
] as unknown as SnapshotChild[]

const members: Member[] = [
  { id: 'm1', displayName: 'Sam', color: '#653437', role: 'owner' },
  { id: 'm2', displayName: 'Alex', color: '#2C7F8C', role: 'adult' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const radios = (w: any) => w.findAll('[role="radio"]')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabindexes = (w: any) => radios(w).map((r: any) => r.attributes('tabindex'))

describe('ChildPicker', () => {
  it('uses a roving tabindex: the selected child, or the first one when none is selected', async () => {
    const w = mountModel(ChildPicker, null, { children })
    expect(tabindexes(w)).toEqual(['0', '-1', '-1'])
    await w.setProps({ modelValue: 'c2' })
    expect(tabindexes(w)).toEqual(['-1', '0', '-1'])
    w.unmount()
  })

  it('arrow keys move the selection and focus, wrapping around', async () => {
    const w = mountModel(ChildPicker, 'c1', { children })

    await radios(w)[0].trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('c2')
    expect(document.activeElement).toBe(radios(w)[1].element)

    await radios(w)[1].trigger('keydown', { key: 'ArrowDown' })
    expect(w.props('modelValue')).toBe('c3')
    await radios(w)[2].trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('c1')

    await radios(w)[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(w.props('modelValue')).toBe('c3')
    expect(document.activeElement).toBe(radios(w)[2].element)
    await radios(w)[2].trigger('keydown', { key: 'ArrowUp' })
    expect(w.props('modelValue')).toBe('c2')
    w.unmount()
  })
})

describe('WhoRow', () => {
  it('marks the group aria-required only when required', () => {
    const required = mountModel(WhoRow, null, { members, required: true })
    expect(required.get('[role="radiogroup"]').attributes('aria-required')).toBe('true')
    required.unmount()

    const optional = mountModel(WhoRow, null, { members, required: false })
    expect(optional.get('[role="radiogroup"]').attributes('aria-required')).toBeUndefined()
    optional.unmount()
  })

  it('uses a roving tabindex and arrow keys move the selection and focus', async () => {
    const w = mountModel(WhoRow, null, { members, required: false })
    expect(tabindexes(w)).toEqual(['0', '-1'])

    await radios(w)[0].trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('m2')
    expect(document.activeElement).toBe(radios(w)[1].element)
    expect(tabindexes(w)).toEqual(['-1', '0'])

    await radios(w)[1].trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('m1')
    await radios(w)[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(w.props('modelValue')).toBe('m2')
    w.unmount()
  })
})

describe('avatars inside picker options', () => {
  it('are decorative, so each option is named by its visible text only', () => {
    const picker = mountModel(ChildPicker, null, { children })
    const who = mountModel(WhoRow, null, { members, required: false })
    for (const w of [picker, who]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const option of radios(w) as any[]) {
        expect(option.find('[role="img"]').exists()).toBe(false)
        expect(option.find('[aria-label]').exists()).toBe(false)
        expect(option.get('span.rounded-full').attributes('aria-hidden')).toBe('true')
      }
      w.unmount()
    }
  })
})
