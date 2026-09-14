import type { Member } from '@/data/snapshot'

/** A new PIN (spec §7.3): 4 digits, typed twice. */
export function validateNewPin(pin: string, confirm: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'PINs are 4 digits.'
  if (pin !== confirm) return 'The two PINs don’t match.'
  return null
}

/** Whether `membershipId` is the household's only owner, who can't leave (spec §6.2). */
export function isLastOwner(members: Member[], membershipId: string): boolean {
  const owners = members.filter((m) => m.role === 'owner')
  return owners.length === 1 && owners[0]!.id === membershipId
}
