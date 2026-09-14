import type { MedicineInput } from '@/data/settingsApi'
import type { Medicine } from '@/domain/types'

/** Mirrored from the database check on `upsert_medicine` (spec §7.4, §11.4). */
export const MEDICINE_NAME_MAX = 60
export const MIN_INTERVAL_HOURS = { min: 0.5, max: 72, step: 0.5 } as const
export const MAX_DOSES_PER_DAY = { min: 1, max: 24, step: 1 } as const

/** The add/edit medicine form (spec §7.9): a name and the two safety numbers a parent enters from the
 *  label or a doctor — Roost Family never suggests values (§11.4). */
export interface MedicineForm {
  name: string
  minIntervalHours: number
  /** Whether a daily maximum is set at all; `maxDosesPer24h` only applies when this is true. */
  hasMaxDoses: boolean
  maxDosesPer24h: number
}

export function emptyMedicineForm(): MedicineForm {
  return { name: '', minIntervalHours: MIN_INTERVAL_HOURS.min, hasMaxDoses: false, maxDosesPer24h: MAX_DOSES_PER_DAY.min }
}

export function medicineFormFrom(medicine: Medicine): MedicineForm {
  return {
    name: medicine.name,
    minIntervalHours: medicine.minIntervalHours,
    hasMaxDoses: medicine.maxDosesPer24h !== null,
    maxDosesPer24h: medicine.maxDosesPer24h ?? MAX_DOSES_PER_DAY.min,
  }
}

export type MedicineFormErrors = Partial<Record<'name', string>>

export function validateMedicineForm(form: MedicineForm): MedicineFormErrors {
  const errors: MedicineFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give this medicine a name.'
  else if ([...name].length > MEDICINE_NAME_MAX) errors.name = `Names can be up to ${MEDICINE_NAME_MAX} characters.`
  return errors
}

export function toMedicineInput(medicineId: string | null, childId: string, form: MedicineForm): MedicineInput {
  return {
    medicineId,
    childId,
    name: form.name.trim(),
    minIntervalHours: form.minIntervalHours,
    maxDosesPer24h: form.hasMaxDoses ? form.maxDosesPer24h : null,
  }
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10)
}

/** The list line for a medicine (design ref: "Every 6h · max 4/day"). */
export function medicineSummaryLine(medicine: Medicine): string {
  const base = `Every ${formatHours(medicine.minIntervalHours)}h`
  return medicine.maxDosesPer24h === null ? base : `${base} · max ${medicine.maxDosesPer24h}/day`
}
