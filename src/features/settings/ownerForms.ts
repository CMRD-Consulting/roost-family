import type { MemberRow } from '@/data/settingsApi'
import { validateMemberName } from '@/features/setup/validation'
import { validateNewPin } from './myAccountForm'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** Settings > Displays: when a display last checked in (spec §7.9 "list with last-seen time"). */
export function formatLastSeen(lastSeenAt: string | null, now: Date): string {
  if (lastSeenAt === null) return 'Never checked in'
  const ago = Math.max(0, now.getTime() - Date.parse(lastSeenAt))
  if (ago < MINUTE) return 'Last seen just now'
  if (ago < HOUR) return `Last seen ${plural(Math.floor(ago / MINUTE), 'minute')} ago`
  if (ago < DAY) return `Last seen ${plural(Math.floor(ago / HOUR), 'hour')} ago`
  return `Last seen ${plural(Math.floor(ago / DAY), 'day')} ago`
}

/** Settings > Members: "Joined Jan 1, 2026" in the household's time zone, or null when unknown. */
export function formatJoined(joinedAt: string | null, timeZone: string): string | null {
  if (joinedAt === null) return null
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(joinedAt))
  return `Joined ${date}`
}

const ROLE_LABELS: Record<MemberRow['role'], string> = { owner: 'Owner', adult: 'Adult', caregiver: 'Caregiver' }

export function roleLabel(role: MemberRow['role']): string {
  return ROLE_LABELS[role]
}

/** Whether `membershipId` is the only owner, who can't be made an Adult or removed (spec §6.2). */
export function isOnlyOwner(rows: MemberRow[], membershipId: string): boolean {
  const owners = rows.filter((r) => r.role === 'owner')
  return owners.length === 1 && owners[0]!.membershipId === membershipId
}

/** The new adult's details when joining from an invite (spec §6.4 step 4). */
export function validateNewMember(input: { name: string; color: string | null; pin: string; pinAgain: string }): string | null {
  return validateMemberName(input.name) ?? (input.color ? null : 'Pick a color.') ?? validateNewPin(input.pin, input.pinAgain)
}

/** Delete household's typed confirmation (spec §11.3); the server checks the same rule. */
export function confirmsHouseholdName(typed: string, householdName: string): boolean {
  return typed.trim() !== '' && typed.trim() === householdName.trim()
}
