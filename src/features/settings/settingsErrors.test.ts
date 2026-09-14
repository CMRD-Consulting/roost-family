import { describe, expect, it } from 'vitest'
import { SettingsError } from '@/data/settingsApi'
import { settingsErrorMessage } from './settingsErrors'

describe('settingsErrorMessage', () => {
  it('shows a validation message from the server as a sentence', () => {
    expect(settingsErrorMessage(new SettingsError('ZIP code must be 5 digits', 'invalid'))).toBe('ZIP code must be 5 digits.')
    expect(settingsErrorMessage(new SettingsError('household name must be 1 to 80 characters.', 'invalid'))).toBe(
      'Household name must be 1 to 80 characters.',
    )
  })

  it('words the other codes for adults', () => {
    expect(settingsErrorMessage(new SettingsError('x', 'auth'))).toBe('Your PIN wasn’t accepted. Close Settings and open it again.')
    expect(settingsErrorMessage(new SettingsError('x', 'network'))).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
    expect(settingsErrorMessage(new SettingsError('x', 'other'))).toBe('Couldn’t save. Try again.')
    expect(settingsErrorMessage(new Error('boom'))).toBe('Couldn’t save. Try again.')
  })
})
