import { useHouseholdStore } from '@/stores/householdStore'

/**
 * Names to strip from error reports before they leave the device (spec §5.9): every child and member
 * of the household, the active and most recently ended sitter, and every medicine name. Reads the live
 * snapshot each time it's called so it always reflects who's currently in the household.
 */
export function getRedactionTerms(): string[] {
  const view = useHouseholdStore().view
  if (!view) return []

  const terms = new Set<string>()
  for (const child of view.children) terms.add(child.name)
  for (const member of view.members) terms.add(member.displayName)
  for (const medicine of view.medicines) terms.add(medicine.name)
  if (view.activeSitterSession?.sitterName) terms.add(view.activeSitterSession.sitterName)
  if (view.recentSitterSession?.sitterName) terms.add(view.recentSitterSession.sitterName)

  return [...terms].filter((term) => term.trim().length > 0)
}
