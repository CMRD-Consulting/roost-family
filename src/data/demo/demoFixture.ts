import { personColor } from '@/ui/personPalette'
import { householdDate } from '@/domain/time'
import type { Medicine, Routine, RoutineStep } from '@/domain/types'
import type { HouseholdPhoto, HouseholdSnapshot, Member, SitterSession, SnapshotChild } from '../snapshot'

const HOUR_MS = 3_600_000
const MIN_MS = 60_000

export interface DemoOptions {
  conflict?: boolean
  manyKids?: boolean
  /** Starts with Sitter Mode on: "Jess" since 2 hours ago, with a few logs attributed to her. */
  sitter?: boolean
  /** Starts with a few sample slideshow photos (bundled SVG scenes) for trying Night Mode and Settings > Photos. */
  photos?: boolean
}

/** A simple landscape-ish SVG scene as a data URL: sky, sun and two hills, in the given colors. */
function sampleScene(sky: string, sun: string, near: string, far: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">` +
    `<rect width="1600" height="1000" fill="${sky}"/><circle cx="1150" cy="330" r="140" fill="${sun}"/>` +
    `<path d="M0 700 Q400 480 850 690 T1600 640 V1000 H0Z" fill="${far}"/>` +
    `<path d="M0 820 Q500 640 1000 830 T1600 800 V1000 H0Z" fill="${near}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function samplePhotos(now: Date): HouseholdPhoto[] {
  const scenes = [
    sampleScene('#f6c28b', '#fff1c9', '#5b7f4a', '#8fae6b'),
    sampleScene('#9ec9e8', '#fffbe6', '#3f6f8f', '#6f9fbf'),
    sampleScene('#d99aa5', '#ffe3c2', '#6b4a6e', '#9b7a9e'),
    sampleScene('#2f3e5c', '#e8e4d0', '#1d2638', '#3b4a68'),
  ]
  return scenes.map((storagePath, i) => ({
    id: `ffffffff-0000-0000-0000-00000000000${i + 1}`,
    storagePath,
    kind: 'slideshow',
    addedAt: new Date(now.getTime() - (scenes.length - i) * 24 * HOUR_MS).toISOString(),
  }))
}

const step = (iconKey: string | null, label: string, time: string | null): RoutineStep => ({
  iconKey,
  photoId: null,
  label,
  time,
})

export function buildDemoSnapshot(now: Date, options: DemoOptions = {}): HouseholdSnapshot {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  const householdId = 'aaaaaaaa-0000-0000-0000-000000000001'
  const timeZone = 'America/New_York'
  const today = householdDate(now, timeZone)

  const sam: Member = {
    id: 'bbbbbbbb-0000-0000-0000-000000000001',
    displayName: 'Sam',
    color: personColor(0),
    role: 'owner',
  }
  const alex: Member = {
    id: 'bbbbbbbb-0000-0000-0000-000000000002',
    displayName: 'Alex',
    color: personColor(1),
    role: 'adult',
  }

  const ivy: SnapshotChild = {
    id: 'cccccccc-0000-0000-0000-000000000001',
    name: 'Ivy',
    birthday: '2023-04-10',
    color: personColor(2),
    nightSleep: { start: '19:00', end: '06:00' },
    sortOrder: 0,
    overrides: {},
  }
  const theo: SnapshotChild = {
    id: 'cccccccc-0000-0000-0000-000000000002',
    name: 'Theo',
    birthday: '2025-06-02',
    color: personColor(3),
    nightSleep: null,
    sortOrder: 1,
    overrides: {},
  }

  const children: SnapshotChild[] = [ivy, theo]

  if (options.manyKids) {
    const extras: [string, string, number][] = [
      ['Mateo', '2026-01-14', 4], // 8 months
      ['Luna', '2024-09-14', 5], // 2 years
      ['Diego', '2022-09-14', 6], // 4 years
      ['Nora', '2020-09-14', 7], // 6 years
    ]
    for (const [name, birthday, colorIndex] of extras) {
      children.push({
        id: `cccccccc-0000-0000-0000-00000000000${colorIndex}`,
        name,
        birthday,
        color: personColor(colorIndex),
        nightSleep: null,
        sortOrder: colorIndex - 2,
        overrides: {},
      })
    }
  }

  const ibuprofenTheo: Medicine = {
    id: 'eeeeeeee-0000-0000-0000-000000000001',
    childId: theo.id,
    name: 'Infant ibuprofen',
    minIntervalHours: 6,
    maxDosesPer24h: 4,
  }
  const acetaminophenTheo: Medicine = {
    id: 'eeeeeeee-0000-0000-0000-000000000002',
    childId: theo.id,
    name: 'Infant acetaminophen',
    minIntervalHours: 4,
    maxDosesPer24h: 5,
  }
  const ibuprofenIvy: Medicine = {
    id: 'eeeeeeee-0000-0000-0000-000000000003',
    childId: ivy.id,
    name: "Children's ibuprofen",
    minIntervalHours: 6,
    maxDosesPer24h: 4,
  }
  const medicines: Medicine[] = [ibuprofenTheo, acetaminophenTheo, ibuprofenIvy]

  const doses: HouseholdSnapshot['doses'] = [
    {
      id: 'ffffffff-0000-0000-0000-000000000001',
      childId: theo.id,
      medicineId: ibuprofenTheo.id,
      at: ago(2 * HOUR_MS),
      loggedByName: 'Sam',
      loggedOffline: false,
      voidedAt: null,
      voidReason: null,
      conflictAcknowledgedAt: null,
      createdAt: ago(2 * HOUR_MS),
      note: '2.5 ml',
      warningsConfirmed: [],
      sitterSessionId: null,
    },
  ]

  if (options.conflict) {
    doses.push({
      id: 'ffffffff-0000-0000-0000-000000000002',
      childId: theo.id,
      medicineId: ibuprofenTheo.id,
      at: ago(HOUR_MS),
      loggedByName: 'Alex',
      loggedOffline: true,
      voidedAt: null,
      voidReason: null,
      conflictAcknowledgedAt: null,
      createdAt: ago(30 * MIN_MS),
      note: null,
      warningsConfirmed: [],
      sitterSessionId: null,
    })
  }

  const sleeps: HouseholdSnapshot['sleeps'] = [
    {
      id: 'sleep-theo-night',
      childId: theo.id,
      startAt: ago(20 * HOUR_MS),
      endAt: ago(9 * HOUR_MS),
      type: 'night',
      sitterSessionId: null,
    },
    {
      id: 'sleep-theo-nap',
      childId: theo.id,
      startAt: ago(4 * HOUR_MS),
      endAt: ago(2 * HOUR_MS + 40 * MIN_MS),
      type: 'nap',
      sitterSessionId: null,
    },
  ]

  const feedings: HouseholdSnapshot['feedings'] = [
    {
      id: 'feed-theo-milk',
      childId: theo.id,
      at: ago(70 * MIN_MS),
      type: 'milk',
      amount: '6 oz',
      note: null,
      sitterSessionId: null,
    },
  ]

  const stickerCategories: HouseholdSnapshot['stickerCategories'] = [
    { id: 'dddddddd-0000-0000-0000-000000000001', name: 'Potty', iconKey: 'potty', sortOrder: 0 },
    { id: 'dddddddd-0000-0000-0000-000000000002', name: 'Teeth', iconKey: 'teeth', sortOrder: 1 },
    { id: 'dddddddd-0000-0000-0000-000000000003', name: 'Tried a new food', iconKey: 'new-food', sortOrder: 2 },
  ]

  const stickers: HouseholdSnapshot['stickers'] = [
    { id: 'sticker-ivy-potty', childId: ivy.id, categoryId: stickerCategories[0]!.id, at: ago(HOUR_MS), sitterSessionId: null },
  ]

  const homeDay: Routine = {
    id: 'routine-ivy-homeday',
    childId: ivy.id,
    name: 'Home day',
    weekdays: [1, 2, 3, 4, 5],
    steps: [
      step('breakfast', 'Breakfast', '07:00'),
      step('teeth', 'Brush teeth', null),
      step('getting-dressed', 'Get dressed', null),
      step('park', 'Park', '09:30'),
      step('snack', 'Snack', null),
      step('nap', 'Nap', '12:30'),
      step('books', 'Books', null),
      step('bath', 'Bath', '18:15'),
      step('bed', 'Bed', '19:00'),
    ],
  }
  const weekend: Routine = {
    id: 'routine-ivy-weekend',
    childId: ivy.id,
    name: 'Weekend',
    weekdays: [0, 6],
    steps: [
      step('breakfast', 'Breakfast', null),
      step('park', 'Park', null),
      step('bath', 'Bath', '18:15'),
      step('bed', 'Bed', '19:00'),
    ],
  }
  const routines: Routine[] = [homeDay, weekend]

  let activeSitterSession: SitterSession | null = null
  if (options.sitter) {
    const sitterSessionId = '99999999-0000-0000-0000-000000000001'
    activeSitterSession = {
      id: sitterSessionId,
      sitterName: 'Jess',
      startedAt: ago(2 * HOUR_MS),
      endedAt: null,
      summaryShownAt: null,
    }
    feedings.push({ id: 'feed-theo-sitter-meal', childId: theo.id, at: ago(90 * MIN_MS), type: 'meal', amount: null, note: 'Pasta and peas', sitterSessionId })
    stickers.push({ id: 'sticker-ivy-sitter-teeth', childId: ivy.id, categoryId: stickerCategories[1]!.id, at: ago(40 * MIN_MS), sitterSessionId })
    doses.push({
      id: 'ffffffff-0000-0000-0000-000000000003',
      childId: theo.id,
      medicineId: acetaminophenTheo.id,
      at: ago(50 * MIN_MS),
      loggedByName: 'Jess (sitter)',
      loggedOffline: false,
      voidedAt: null,
      voidReason: null,
      conflictAcknowledgedAt: null,
      createdAt: ago(50 * MIN_MS),
      note: '5 ml',
      warningsConfirmed: [],
      sitterSessionId,
    })
  }

  const routineProgress: HouseholdSnapshot['routineProgress'] = [
    { childId: ivy.id, routineId: homeDay.id, day: today, completed: [0, 1, 2] },
  ]

  const jots: HouseholdSnapshot['jots'] = [
    { id: 'jot-1', text: "Call pediatrician about Theo's rash", createdAt: ago(2 * HOUR_MS), doneAt: null },
  ]

  const groceries: HouseholdSnapshot['groceries'] = [
    { id: 'grocery-1', text: 'Whole milk', createdAt: ago(20 * HOUR_MS), checkedAt: null },
    { id: 'grocery-2', text: 'Bananas', createdAt: ago(20 * HOUR_MS), checkedAt: null },
  ]

  return {
    household: {
      id: householdId,
      name: 'Rivera',
      zip: '28202',
      hasLocation: true,
      timeZone,
      defaultNightSleep: { start: '18:00', end: '05:00' },
      nightMode: { start: '20:00', end: '06:00' },
      leaveByBufferMin: 20,
      diaperLogEnabled: false,
      dinnerTonight: 'Tacos',
      sitterInfo: {
        napInstructions: 'Theo naps in the crib with the sound machine on.',
        bedtime: 'Ivy 7:00 PM, Theo 6:30 PM',
        emergencyContacts: 'Sam 704-555-0101 · Alex 704-555-0102',
        pediatrician: 'Dr. Patel 704-555-0199',
        address: '12 Maple St',
        whereThings: 'Spare diapers: hall closet',
      },
    },
    members: [sam, alex],
    children,
    medicines,
    doses,
    sleeps,
    feedings,
    diapers: [],
    stickerCategories,
    stickers,
    routines,
    routineProgress,
    routineOverrides: [],
    jots,
    groceries,
    activeSitterSession,
    recentSitterSession: null,
    unseenSitterSessions: [],
    weather: {
      fetchedAt: now.toISOString(),
      currentTempF: 74,
      highF: 78,
      lowF: 61,
      precipChance: 10,
      summary: 'Mostly Sunny',
      icon: 'partly',
    },
    photos: options.photos ? samplePhotos(now) : [],
    loadedAt: now.toISOString(),
  }
}
