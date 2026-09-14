import type { Feature, HouseholdDate } from './types'

export interface FeatureContext {
  birthday: HouseholdDate
  today: HouseholdDate
  overrides: Partial<Record<Feature, boolean>>
  diaperLogEnabled: boolean
}

function parseDate(d: HouseholdDate): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) throw new Error(`Invalid date "${d}"`)
  return [y, m, day]
}

export function ageInMonths(birthday: HouseholdDate, today: HouseholdDate): number {
  const [by, bm, bd] = parseDate(birthday)
  const [ty, tm, td] = parseDate(today)
  let months = (ty - by) * 12 + (tm - bm)
  if (td < bd) months -= 1
  return months
}

export function isFeatureEnabled(feature: Feature, ctx: FeatureContext): boolean {
  if (feature === 'diaper') return ctx.diaperLogEnabled && ctx.overrides.diaper !== false

  const override = ctx.overrides[feature]
  if (override !== undefined) return override

  const months = ageInMonths(ctx.birthday, ctx.today)
  switch (feature) {
    case 'wakeWindow':
    case 'feeding':
      return months < 36
    case 'kidsCorner':
      return months >= 24 && months < 96
  }
}
