import type { DoseEntry, Medicine } from './types'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type DoseWarning =
  | { kind: 'early'; nearestDoseAt: Date; nearestDoseBy: string | null; elapsedMs: number; minIntervalHours: number }
  | { kind: 'overMax'; doseNumber: number; max: number }

export interface DoseSummary {
  childId: string
  medicineId: string
  medicineName: string
  givenAt: Date
  givenBy: string | null
  nextAfter: Date
  nextAllowed: boolean
}

const isActive = (d: DoseEntry) => d.voidedAt === null

export function nextDoseAfter(dose: DoseEntry, medicine: Medicine): Date {
  return new Date(Date.parse(dose.at) + medicine.minIntervalHours * HOUR_MS)
}

export function checkDose(medicine: Medicine, doses: DoseEntry[], at: Date, excludeDoseId?: string): DoseWarning[] {
  const others = doses.filter((d) => isActive(d) && d.medicineId === medicine.id && d.id !== excludeDoseId)
  const t = at.getTime()
  const intervalMs = medicine.minIntervalHours * HOUR_MS
  const warnings: DoseWarning[] = []

  const nearest = others
    .map((d) => ({ d, gap: Math.abs(t - Date.parse(d.at)) }))
    .filter((x) => x.gap < intervalMs)
    .sort((a, b) => a.gap - b.gap)[0]
  if (nearest) {
    warnings.push({
      kind: 'early',
      nearestDoseAt: new Date(nearest.d.at),
      nearestDoseBy: nearest.d.loggedByName,
      elapsedMs: nearest.gap,
      minIntervalHours: medicine.minIntervalHours,
    })
  }

  if (medicine.maxDosesPer24h !== null) {
    // Any 24h window [s, s + 24h) containing the checked dose might be the one that
    // pushes it over the limit. Candidate starts are the checked dose's own time and
    // the times of other active doses in the 24h before it — those are the only
    // times a window could start and still contain the checked dose.
    const otherTimes = others.map((d) => Date.parse(d.at))
    const candidateStarts = new Set<number>([t])
    for (const dt of otherTimes) {
      if (dt > t - DAY_MS && dt <= t) candidateStarts.add(dt)
    }

    let doseNumber = 0
    for (const s of candidateStarts) {
      const count = 1 + otherTimes.filter((dt) => dt >= s && dt < s + DAY_MS).length
      if (count > doseNumber) doseNumber = count
    }

    if (doseNumber > medicine.maxDosesPer24h) {
      warnings.push({ kind: 'overMax', doseNumber, max: medicine.maxDosesPer24h })
    }
  }

  return warnings
}

export function recentDoses(medicines: Medicine[], doses: DoseEntry[], now: Date): DoseSummary[] {
  const t = now.getTime()
  const summaries: DoseSummary[] = []
  for (const medicine of medicines) {
    const latest = doses
      .filter((d) => isActive(d) && d.medicineId === medicine.id)
      .filter((d) => {
        const dt = Date.parse(d.at)
        return dt > t - DAY_MS && dt <= t
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
    if (!latest) continue
    const nextAfter = nextDoseAfter(latest, medicine)
    summaries.push({
      childId: medicine.childId,
      medicineId: medicine.id,
      medicineName: medicine.name,
      givenAt: new Date(latest.at),
      givenBy: latest.loggedByName,
      nextAfter,
      nextAllowed: t >= nextAfter.getTime(),
    })
  }
  return summaries.sort((a, b) => b.givenAt.getTime() - a.givenAt.getTime())
}

export function unacknowledgedConflicts(medicines: Medicine[], doses: DoseEntry[]): DoseEntry[] {
  const byId = new Map(medicines.map((m) => [m.id, m]))
  return doses.filter((d) => {
    if (!isActive(d) || !d.loggedOffline || d.conflictAcknowledgedAt !== null) return false
    const medicine = byId.get(d.medicineId)
    return medicine ? checkDose(medicine, doses, new Date(d.at), d.id).length > 0 : false
  })
}
