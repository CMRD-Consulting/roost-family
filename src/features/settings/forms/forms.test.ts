import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { PERSON_COLORS } from '@/ui/personPalette'
import ColorPicker from './ColorPicker.vue'
import Stepper from './Stepper.vue'
import TimeField from './TimeField.vue'
import ToggleField from './ToggleField.vue'

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
