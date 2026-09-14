export interface TimeZoneOption {
  id: string
  label: string
}

/** Curated US zones offered in setup. */
export const US_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
]

export const DEFAULT_TIME_ZONE = 'America/New_York'

export function isListedTimeZone(id: string): boolean {
  return US_TIME_ZONES.some((z) => z.id === id)
}

/** The detected zone when it is listed; otherwise Eastern, flagged so the screen can ask the adult to pick. */
export function initialTimeZone(detected: string | undefined): { id: string; matched: boolean } {
  return detected && isListedTimeZone(detected)
    ? { id: detected, matched: true }
    : { id: DEFAULT_TIME_ZONE, matched: false }
}

export function detectedTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
