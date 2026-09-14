import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConsentStep from './ConsentStep.vue'
import { createWizardState } from '../wizardState'

describe('ConsentStep', () => {
  it('gives each checkbox its sentence as an explicit accessible name', () => {
    const wrapper = mount(ConsentStep, { props: { state: createWizardState() } })
    const boxes = wrapper.findAll('input[type="checkbox"]').map((b) => b.element as HTMLInputElement)
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.id).every((id) => id.length > 0)).toBe(true)
    expect(boxes[0]!.labels![0]!.textContent?.trim()).toBe('I agree to the Terms and Privacy Policy.')
    expect(boxes[1]!.labels![0]!.textContent?.trim()).toMatch(/^I consent to Roost Family storing/)
  })
})
