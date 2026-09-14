import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { PERSON_COLORS } from '@/ui/personPalette'
import ColorPicker from './ColorPicker.vue'
import { ICON_KEYS } from './iconKeys'
import IconPicker from './IconPicker.vue'
import Stepper from './Stepper.vue'
import TimeField from './TimeField.vue'
import ToggleField from './ToggleField.vue'
import TriStateToggle from './TriStateToggle.vue'

describe('Stepper', () => {
  it('steps up and down within the bounds', async () => {
    const w = mount(Stepper, { props: { label: 'Buffer', min: 0, max: 10, step: 5, unit: 'min', modelValue: 5 } })
    await w.find('button[aria-label="Increase Buffer"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[10]])
    await w.setProps({ modelValue: 10 })
    expect(w.find('output').text()).toBe('10 min')
    expect(w.find('button[aria-label="Increase Buffer"]').attributes('disabled')).toBeDefined()
    await w.setProps({ modelValue: 3 })
    await w.find('button[aria-label="Decrease Buffer"]').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([0])
  })
})

describe('ToggleField', () => {
  it('is a switch that flips its value', async () => {
    const w = mount(ToggleField, { props: { label: 'Diaper log', modelValue: false } })
    const button = w.find('button[role="switch"]')
    expect(button.attributes('aria-checked')).toBe('false')
    await button.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[true]])
  })
})

describe('TimeField', () => {
  it('labels a time input and describes its error', async () => {
    const w = mount(TimeField, { props: { label: 'Starts', modelValue: '20:00', error: 'Enter a time.' } })
    const input = w.find('input[type="time"]')
    expect(w.find('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(w.find(`#${CSS.escape(input.attributes('aria-describedby')!)}`).text()).toBe('Enter a time.')
    await input.setValue('21:30')
    expect(w.emitted('update:modelValue')).toEqual([['21:30']])
  })
})

describe('ColorPicker', () => {
  it('offers the person colors by name and selects one', async () => {
    const w = mount(ColorPicker, { props: { label: 'Color', modelValue: PERSON_COLORS[1] } })
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(PERSON_COLORS.length)
    expect(radios[1]!.attributes('aria-checked')).toBe('true')
    expect(radios[1]!.attributes('aria-label')).toBe('Teal')
    await radios[0]!.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[PERSON_COLORS[0]]])
  })
})

describe('TriStateToggle', () => {
  it('shows the computed default, and each option sets the right value', async () => {
    const w = mount(TriStateToggle, { props: { label: 'Feeding', computedDefault: true, modelValue: null } })
    const radios = w.findAll('[role="radio"]')
    expect(radios.map((r) => r.text())).toEqual(['Default (On)', 'On', 'Off'])
    expect(radios[0]!.attributes('aria-checked')).toBe('true')

    await radios[1]!.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[true]])
    await radios[2]!.trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([false])
    await radios[0]!.trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([null])
  })

  it('shows the default as Off when that is what it resolves to', () => {
    const w = mount(TriStateToggle, { props: { label: 'Diaper log', computedDefault: false, modelValue: false } })
    expect(w.findAll('[role="radio"]')[0]!.text()).toBe('Default (Off)')
    expect(w.findAll('[role="radio"]')[2]!.attributes('aria-checked')).toBe('true')
  })
})

describe('IconPicker', () => {
  it('offers every icon by a readable name and selects one', async () => {
    const w = mount(IconPicker, { props: { label: 'Icon', modelValue: 'potty' } })
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(ICON_KEYS.length)
    expect(radios.find((r) => r.attributes('aria-checked') === 'true')!.attributes('aria-label')).toBe('Potty')
    const dressed = radios.find((r) => r.attributes('aria-label') === 'Getting Dressed')!
    await dressed.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['getting-dressed']])
  })
})
