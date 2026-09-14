import { SettingsError } from '@/data/settingsApi'

/** A failed Settings save, worded for the adult. Validation messages come from the server as-is (spec §7.9). */
export function settingsErrorMessage(error: unknown): string {
  if (!(error instanceof SettingsError)) return 'Couldn’t save. Try again.'
  switch (error.code) {
    case 'invalid': {
      const text = error.message.trim()
      const sentence = text.charAt(0).toUpperCase() + text.slice(1)
      return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
    }
    case 'auth':
      return 'Your PIN wasn’t accepted. Close Settings and open it again.'
    case 'network':
      return 'Couldn’t reach Roost Family. Check the connection and try again.'
    default:
      return 'Couldn’t save. Try again.'
  }
}
