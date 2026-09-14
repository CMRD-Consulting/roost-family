import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import RChips from './RChips.vue'
import RTimeStepper from './RTimeStepper.vue'
import RPinPad from './RPinPad.vue'
import RSheet from './RSheet.vue'
import RInput from './RInput.vue'
import type { Member } from '@/data/snapshot'

/** Mount a `defineModel`-based component, wiring modelValue <-> update:modelValue like a real v-model. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountModel(Component: any, modelValue: unknown, props: Record<string, unknown> = {}): any {
  const wrapper: any = mount(Component, {
    props: {
      modelValue,
      'onUpdate:modelValue': (v: unknown) => wrapper.setProps({ modelValue: v }),
      ...props,
    },
  })
  return wrapper
}

describe('RChips', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C', disabled: true },
    { value: 'd', label: 'D' },
  ]

  it('is a radiogroup with radio chips reflecting the selection', () => {
    const w = mountModel(RChips, null, { options, label: 'Type' })
    expect(w.get('[role="radiogroup"]').attributes('aria-label')).toBe('Type')
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(4)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(radios.every((r: any) => r.attributes('aria-checked') === 'false')).toBe(true)
  })

  it('selects a chip on click and marks it checked', async () => {
    const w = mountModel(RChips, null, { options, label: 'Type' })
    await w.findAll('[role="radio"]')[0]!.trigger('click')
    expect(w.props('modelValue')).toBe('a')
    expect(w.findAll('[role="radio"]')[0]!.attributes('aria-checked')).toBe('true')
  })

  it('clears the selection when the selected chip is tapped again, only if deselectable', async () => {
    const plain = mountModel(RChips, 'a', { options, label: 'Type' })
    await plain.findAll('[role="radio"]')[0]!.trigger('click')
    expect(plain.props('modelValue')).toBe('a')

    const w = mountModel(RChips, 'a', { options, label: 'Amount', deselectable: true })
    await w.findAll('[role="radio"]')[0]!.trigger('click')
    expect(w.props('modelValue')).toBeNull()
  })

  it('ignores clicks on a disabled chip', async () => {
    const w = mountModel(RChips, 'a', { options, label: 'Type' })
    await w.findAll('[role="radio"]')[2]!.trigger('click')
    expect(w.props('modelValue')).toBe('a')
  })

  it('moves selection with arrow keys, skipping disabled options', async () => {
    const w = mountModel(RChips, 'a', { options, label: 'Type' })
    await w.findAll('[role="radio"]')[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('b')
    // From 'b', the next enabled option skips disabled 'c' and lands on 'd'.
    await w.findAll('[role="radio"]')[1]!.trigger('keydown', { key: 'ArrowRight' })
    expect(w.props('modelValue')).toBe('d')
    await w.findAll('[role="radio"]')[3]!.trigger('keydown', { key: 'ArrowLeft' })
    expect(w.props('modelValue')).toBe('b')
  })
})

describe('RTimeStepper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T19:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  const now = '2026-09-14T19:00:00.000Z'
  const min = '2026-09-14T18:50:00.000Z' // now - 10 min

  it('shows the clock time and "now" at the max bound, with +5 disabled', () => {
    const w = mountModel(RTimeStepper, now, { min, max: now, timeZone: 'UTC' })
    expect(w.text()).toContain('now')
    const buttons = w.findAll('button')
    expect(buttons[1]!.attributes('disabled')).toBeDefined() // +5 min
    expect(buttons[0]!.attributes('disabled')).toBeUndefined() // -5 min
  })

  it('steps by 5 minutes, clamps at the bounds, and disables the exhausted button', async () => {
    const w = mountModel(RTimeStepper, now, { min, max: now, timeZone: 'UTC' })
    const buttons = w.findAll('button')
    await buttons[0]!.trigger('click') // -5 min
    expect(w.props('modelValue')).toBe('2026-09-14T18:55:00.000Z')
    expect(w.text()).toContain('5m ago')

    await w.findAll('button')[0]!.trigger('click') // -5 min again -> hits min
    expect(w.props('modelValue')).toBe(min)
    expect(w.findAll('button')[0]!.attributes('disabled')).toBeDefined()

    // Further clicks stay clamped at min.
    await w.findAll('button')[0]!.trigger('click')
    expect(w.props('modelValue')).toBe(min)
  })
})

describe('RPinPad', () => {
  const members: Member[] = [
    { id: 'm1', displayName: 'Sam', color: '#653437', role: 'owner' },
    { id: 'm2', displayName: 'Alex', color: '#2C7F8C', role: 'adult' },
  ]

  it('walks the wrong-then-right PIN flow with a fake verify', async () => {
    const verify = vi.fn(async (membershipId: string, pin: string) => membershipId === 'm1' && pin === '1234')
    const w = mount(RPinPad, { props: { members, verify } })

    expect(w.text()).toContain('Sam')
    expect(w.text()).toContain('Alex')
    await w.findAll('button')[0]!.trigger('click') // pick Sam

    const digit = (label: string) => w.findAll('button').find((b) => b.text() === label)!

    await digit('1').trigger('click')
    await digit('1').trigger('click')
    await digit('1').trigger('click')
    await digit('1').trigger('click')
    await flushPromises()

    expect(verify).toHaveBeenCalledWith('m1', '1111')
    expect(w.text()).toContain("That PIN didn't match.")
    expect(w.emitted('verified')).toBeUndefined()

    await digit('1').trigger('click')
    await digit('2').trigger('click')
    await digit('3').trigger('click')
    await digit('4').trigger('click')
    await flushPromises()

    expect(verify).toHaveBeenCalledWith('m1', '1234')
    expect(w.emitted('verified')).toEqual([[{ membershipId: 'm1', pin: '1234' }]])
  })

  const pressDigits = async (w: ReturnType<typeof mount>, digits: string) => {
    for (const d of digits) await w.findAll('button').find((b) => b.text() === d)!.trigger('click')
    await flushPromises()
  }

  it('when verify rejects, clears the digits and says the PIN could not be checked', async () => {
    const verify = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true)
    const w = mount(RPinPad, { props: { members, verify } })
    await w.get('button[aria-label="Sam"]').trigger('click')

    await pressDigits(w, '1234')

    const alert = w.get('[role="alert"]')
    expect(alert.text()).toBe("Couldn't check the PIN. Try again.")
    expect(alert.classes()).toContain('text-[18px]')
    expect(w.get('[aria-live="polite"]').text()).toBe('0 of 4 digits entered')
    expect(w.emitted('verified')).toBeUndefined()

    await pressDigits(w, '1234')
    expect(w.emitted('verified')).toEqual([[{ membershipId: 'm1', pin: '1234' }]])
  })

  it('lists adults as plain named buttons, not a radiogroup', () => {
    const w = mount(RPinPad, { props: { members, verify: async () => true } })
    expect(w.find('[role="radiogroup"]').exists()).toBe(false)
    expect(w.find('[role="radio"]').exists()).toBe(false)
    const list = w.get('ul')
    expect(list.findAll('li > button').map((b) => b.attributes('aria-label'))).toEqual(['Sam', 'Alex'])
  })

  it('keypad: the blank key is a non-interactive spacer, "Not you?" is at least 60 px tall, and progress is announced', async () => {
    const w = mount(RPinPad, { props: { members, verify: async () => true } })
    await w.get('button[aria-label="Sam"]').trigger('click')

    const keypadButtons = w.findAll('[data-keypad] button')
    expect(keypadButtons.map((b) => b.attributes('aria-label'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Backspace'])
    const spacer = w.get('[data-keypad] [data-spacer]')
    expect(spacer.element.tagName).not.toBe('BUTTON')
    expect(spacer.attributes('aria-hidden')).toBe('true')

    const notYou = w.findAll('button').find((b) => b.text().includes('Not you?'))!
    expect(notYou.classes()).toContain('min-h-[60px]')

    const status = w.get('[aria-live="polite"]')
    expect(status.text()).toBe('0 of 4 digits entered')
    await w.get('button[aria-label="1"]').trigger('click')
    await w.get('button[aria-label="2"]').trigger('click')
    expect(status.text()).toBe('2 of 4 digits entered')
  })

  it('emits cancel', async () => {
    const w = mount(RPinPad, { props: { members, verify: async () => true } })
    await w.findAll('button').find((b) => b.text() === 'Cancel')!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})

describe('RSheet', () => {
  it('renders a dialog with aria-modal and closes on Escape', async () => {
    const w = mount(RSheet, { props: { title: 'Log feeding', open: true }, attachTo: document.body })
    const dialog = w.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBeTruthy()

    await dialog.trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('Escape closes only the topmost of two stacked sheets', async () => {
    const Stacked = defineComponent({
      components: { RSheet },
      emits: ['outerClose', 'innerClose'],
      template: `
        <RSheet title="Outer" :open="true" @close="$emit('outerClose')">
          <button type="button">Outer action</button>
          <RSheet title="Inner" :open="true" @close="$emit('innerClose')">
            <button type="button" id="inner-action">Inner action</button>
          </RSheet>
        </RSheet>`,
    })
    const w = mount(Stacked, { attachTo: document.body })
    await flushPromises()

    await w.get('#inner-action').trigger('keydown', { key: 'Escape' })

    expect(w.emitted('innerClose')).toHaveLength(1)
    expect(w.emitted('outerClose')).toBeUndefined()
    w.unmount()
  })

  it('traps focus: Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last', async () => {
    const w = mount(RSheet, {
      props: { title: 'Log feeding', open: true },
      slots: { default: '<button type="button" id="a">A</button><button type="button" id="b">B</button>' },
      attachTo: document.body,
    })
    await flushPromises()
    const close = w.get('button[aria-label="Close"]').element as HTMLButtonElement
    const last = w.get('#b').element as HTMLButtonElement

    last.focus()
    await w.get('#b').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    close.focus()
    await w.get('button[aria-label="Close"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    // From the panel itself (focused on open), Shift+Tab also stays inside.
    ;(w.get('[role="dialog"]').element as HTMLElement).focus()
    await w.get('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    w.unmount()
  })

  it('returns focus to the opener when unmounted while open', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const w = mount(RSheet, { props: { title: 'Log feeding', open: true }, attachTo: document.body })
    await flushPromises()
    expect(document.activeElement).not.toBe(opener)

    w.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('closes when the close button is tapped', async () => {
    const w = mount(RSheet, { props: { title: 'Log feeding', open: true } })
    await w.get('button[aria-label="Close"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('renders nothing when closed', () => {
    const w = mount(RSheet, { props: { title: 'Log feeding', open: false } })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('RInput', () => {
  it('associates the label with the input via a generated id', () => {
    const w = mountModel(RInput, '', { label: 'Note' })
    const input = w.get('input').element as HTMLInputElement
    expect(input.labels).toHaveLength(1)
    expect(input.labels![0]!.textContent).toBe('Note')
  })
})
