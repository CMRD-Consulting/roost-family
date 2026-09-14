import { describe, expect, it } from 'vitest'
import type { Medicine } from '@/domain/types'
import {
  emptyMedicineForm, medicineFormFrom, medicineSummaryLine, toMedicineInput, validateMedicineForm,
} from './medicineForm'

const ibuprofen: Medicine = { id: 'm1', childId: 'theo', name: 'Infant ibuprofen', minIntervalHours: 6, maxDosesPer24h: 4 }

describe('emptyMedicineForm', () => {
  it('starts with no daily maximum', () => {
    expect(emptyMedicineForm()).toEqual({ name: '', minIntervalHours: 0.5, hasMaxDoses: false, maxDosesPer24h: 1 })
  })
})

describe('medicineFormFrom', () => {
  it('fills from a medicine with a maximum', () => {
    expect(medicineFormFrom(ibuprofen)).toEqual({ name: 'Infant ibuprofen', minIntervalHours: 6, hasMaxDoses: true, maxDosesPer24h: 4 })
  })

  it('turns off the maximum toggle when there is none', () => {
    const form = medicineFormFrom({ ...ibuprofen, maxDosesPer24h: null })
    expect(form.hasMaxDoses).toBe(false)
    expect(form.maxDosesPer24h).toBe(1)
  })
})

describe('validateMedicineForm', () => {
  it('requires a non-empty name up to 60 characters', () => {
    expect(validateMedicineForm({ ...emptyMedicineForm(), name: '  ' })).toEqual({ name: 'Give this medicine a name.' })
    expect(validateMedicineForm({ ...emptyMedicineForm(), name: 'x'.repeat(61) })).toEqual({ name: 'Names can be up to 60 characters.' })
    expect(validateMedicineForm({ ...emptyMedicineForm(), name: 'Tylenol' })).toEqual({})
  })
})

describe('toMedicineInput', () => {
  it('sends null for the maximum when the toggle is off', () => {
    const form = { name: '  Tylenol  ', minIntervalHours: 4, hasMaxDoses: false, maxDosesPer24h: 5 }
    expect(toMedicineInput(null, 'theo', form)).toEqual({
      medicineId: null, childId: 'theo', name: 'Tylenol', minIntervalHours: 4, maxDosesPer24h: null,
    })
  })

  it('carries the medicine id through for an edit and the maximum when the toggle is on', () => {
    const form = { name: 'Tylenol', minIntervalHours: 4, hasMaxDoses: true, maxDosesPer24h: 5 }
    expect(toMedicineInput('m1', 'theo', form)).toEqual({
      medicineId: 'm1', childId: 'theo', name: 'Tylenol', minIntervalHours: 4, maxDosesPer24h: 5,
    })
  })
})

describe('medicineSummaryLine', () => {
  it('shows the interval and maximum', () => {
    expect(medicineSummaryLine(ibuprofen)).toBe('Every 6h · max 4/day')
  })

  it('omits the maximum when there is none', () => {
    expect(medicineSummaryLine({ ...ibuprofen, maxDosesPer24h: null })).toBe('Every 6h')
  })

  it('shows a fractional interval to one decimal', () => {
    expect(medicineSummaryLine({ ...ibuprofen, minIntervalHours: 6.5, maxDosesPer24h: null })).toBe('Every 6.5h')
    expect(medicineSummaryLine({ ...ibuprofen, minIntervalHours: 0.5, maxDosesPer24h: null })).toBe('Every 0.5h')
  })
})
