import type { KidDraft } from './wizardState'

export function validateInviteCode(code: string): string | null {
  return /^[A-Za-z0-9]{6}$/.test(code.trim()) ? null : 'Invite codes are 6 letters or numbers.'
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.'
}

export function validateCode(code: string): string | null {
  return /^\d{6}$/.test(code.trim()) ? null : 'Enter the 6-digit code from your email.'
}

export function validateHousehold(h: { householdName: string; zip: string }): string | null {
  if (!h.householdName.trim()) return 'Give your household a name.'
  if (h.zip && !/^\d{5}$/.test(h.zip)) return 'ZIP codes are 5 digits.'
  return null
}

export function validateKids(kids: KidDraft[], today: string): string | null {
  if (kids.length === 0) return 'Add at least one child.'
  if (kids.length > 8) return 'A household can have up to 8 children.'
  for (const kid of kids) {
    if (!kid.name.trim()) return 'Every child needs a name.'
    if (!kid.birthday) return 'Every child needs a birthday.'
    if (kid.birthday > today) return 'Birthdays can’t be in the future.'
  }
  return null
}

export function validatePin(pin: string, confirm: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'Your PIN is 4 digits.'
  if (pin !== confirm) return 'The PINs don’t match.'
  return null
}
