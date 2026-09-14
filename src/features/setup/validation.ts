import type { KidDraft } from './wizardState'
import { isListedTimeZone } from './timeZones'

/** Limits mirrored from the database's check constraints. */
export const LIMITS = {
  householdName: 80,
  personName: 40,
  displayName: 40,
  inviteCode: 6,
  zip: 5,
  pin: 4,
} as const

/** Length in code points, as Postgres char_length counts it. */
function charLength(s: string): number {
  return [...s].length
}

/** Uppercase A–Z and 0–9 only, at most 6 characters. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LIMITS.inviteCode)
}

export function validateInviteCode(code: string): string | null {
  return /^[A-Za-z0-9]{6}$/.test(code.trim()) ? null : 'Invite codes are 6 letters or numbers.'
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.'
}

export function validateCode(code: string): string | null {
  return /^\d{6}$/.test(code.trim()) ? null : 'Enter the 6-digit code from your email.'
}

export function validateHousehold(h: { householdName: string; zip: string; timeZone: string }): string | null {
  const name = h.householdName.trim()
  if (!name) return 'Give your household a name.'
  if (charLength(name) > LIMITS.householdName) return `Household names can be up to ${LIMITS.householdName} characters.`
  if (h.zip && !/^\d{5}$/.test(h.zip)) return 'ZIP codes are 5 digits.'
  if (!isListedTimeZone(h.timeZone)) return 'Pick your time zone.'
  return null
}

export function validateKids(kids: KidDraft[], today: string): string | null {
  if (kids.length === 0) return 'Add at least one child.'
  if (kids.length > 8) return 'A household can have up to 8 children.'
  for (const kid of kids) {
    const name = kid.name.trim()
    if (!name) return 'Every child needs a name.'
    if (charLength(name) > LIMITS.personName) return `Names can be up to ${LIMITS.personName} characters.`
    if (!kid.birthday) return 'Every child needs a birthday.'
    if (kid.birthday > today) return 'Birthdays can’t be in the future.'
  }
  return null
}

export function validateMemberName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Tell us what to call you.'
  if (charLength(trimmed) > LIMITS.personName) return `Names can be up to ${LIMITS.personName} characters.`
  return null
}

export function validateDisplayLabel(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed) return 'Name this display.'
  if (charLength(trimmed) > LIMITS.displayName) return `Display names can be up to ${LIMITS.displayName} characters.`
  return null
}

export function validatePin(pin: string, confirm: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Your PIN is 4 digits.'
  if (pin !== confirm) return 'The PINs don’t match.'
  return null
}
