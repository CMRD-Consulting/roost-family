import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import InviteStep from './InviteStep.vue'
import { createWizardState } from '../wizardState'

function mountStep() {
  const state = createWizardState()
  const wrapper = mount(InviteStep, { props: { state } })
  return { state, wrapper, input: wrapper.get('input') }
}

describe('InviteStep', () => {
  it('uses one 6-character input with autocorrect off', () => {
    const { wrapper, input } = mountStep()
    expect(wrapper.findAll('input')).toHaveLength(1)
    expect(input.attributes()).toMatchObject({
      maxlength: '6',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      autocomplete: 'off',
    })
  })

  it('normalizes typed input to uppercase letters and digits and mirrors it in six boxes', async () => {
    const { state, wrapper, input } = mountStep()
    await input.setValue('ro-o')
    expect(state.inviteCode).toBe('ROO')
    expect((input.element as HTMLInputElement).value).toBe('ROO')
    const boxes = wrapper.findAll('[aria-hidden="true"] > span')
    expect(boxes).toHaveLength(6)
    expect(boxes.map((b) => b.text())).toEqual(['R', 'O', 'O', '', '', ''])
  })

  it('normalizes pasted codes', async () => {
    const { state, input } = mountStep()
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => ' roost-1 extra' } })
    input.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(state.inviteCode).toBe('ROOST1')
  })
})
