import { afterEach, describe, expect, it } from 'vitest'
import { createDemoSettingsApi, getDemoDisplayName, resetDemoSettingsApiForTests } from './demoSettingsApi'
import { getDemoSnapshot, resetDemoForTests } from './demoHousehold'
import { SettingsError } from '../settingsApi'

const SAM_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALEX_ID = 'bbbbbbbb-0000-0000-0000-000000000002'
const IVY_ID = 'cccccccc-0000-0000-0000-000000000001'
const THEO_ID = 'cccccccc-0000-0000-0000-000000000002'
const HOMEDAY_ROUTINE = 'routine-ivy-homeday'
const IBUPROFEN_THEO = 'eeeeeeee-0000-0000-0000-000000000001'

afterEach(() => {
  resetDemoForTests()
  resetDemoSettingsApiForTests()
})

const auth = { membershipId: SAM_ID, pin: '1234' }

describe('createDemoSettingsApi', () => {
  describe('PIN checking', () => {
    it('rejects a wrong PIN and does not mutate', async () => {
      const api = createDemoSettingsApi()
      await expect(api.setMyColor({ membershipId: SAM_ID, pin: '0000' }, '#000000')).rejects.toMatchObject({
        message: 'Incorrect PIN', code: 'auth',
      })
      expect(getDemoSnapshot(new Date()).members.find((m) => m.id === SAM_ID)?.color).not.toBe('#000000')
    })

    it('accepts Alex\'s PIN too', async () => {
      const api = createDemoSettingsApi()
      await api.setMyColor({ membershipId: ALEX_ID, pin: '5678' }, '#123456')
      expect(getDemoSnapshot(new Date()).members.find((m) => m.id === ALEX_ID)?.color).toBe('#123456')
    })
  })

  it('settingsVerify returns the role and display name for a valid PIN', async () => {
    const api = createDemoSettingsApi()
    await expect(api.settingsVerify(auth)).resolves.toEqual({ role: 'owner', displayName: 'Sam' })
    await expect(api.settingsVerify({ membershipId: ALEX_ID, pin: '5678' })).resolves.toEqual({ role: 'adult', displayName: 'Alex' })
  })

  it('settingsVerify rejects an unknown membership id even with a PIN that matches nothing', async () => {
    const api = createDemoSettingsApi()
    await expect(api.settingsVerify({ membershipId: 'unknown', pin: '1234' })).rejects.toBeInstanceOf(SettingsError)
  })

  it('updateHouseholdSettings mutates the household fields', async () => {
    const api = createDemoSettingsApi()
    await api.updateHouseholdSettings(auth, {
      name: 'Rivera-Chen', zip: '29710', timeZone: 'America/Chicago', leaveByBufferMin: 30,
      defaultNightSleep: { start: '19:30', end: '06:30' }, nightMode: { start: '21:00', end: '06:00' }, diaperLogEnabled: true,
    })
    const household = getDemoSnapshot(new Date()).household
    expect(household).toMatchObject({
      name: 'Rivera-Chen', zip: '29710', timeZone: 'America/Chicago', leaveByBufferMin: 30,
      defaultNightSleep: { start: '19:30', end: '06:30' }, nightMode: { start: '21:00', end: '06:00' }, diaperLogEnabled: true,
    })
  })

  it('updateSitterInfo replaces the sitter info', async () => {
    const api = createDemoSettingsApi()
    await api.updateSitterInfo(auth, { napInstructions: 'Updated instructions' })
    expect(getDemoSnapshot(new Date()).household.sitterInfo).toEqual({ napInstructions: 'Updated instructions' })
  })

  describe('children', () => {
    it('addChild appends a new child and returns its id', async () => {
      const api = createDemoSettingsApi()
      const before = getDemoSnapshot(new Date()).children.length
      const id = await api.addChild(auth, { name: 'Nora', birthday: '2024-01-01', color: '#111111' })
      const snapshot = getDemoSnapshot(new Date())
      expect(snapshot.children).toHaveLength(before + 1)
      expect(snapshot.children.at(-1)).toMatchObject({ id, name: 'Nora', birthday: '2024-01-01', color: '#111111', overrides: {} })
    })

    it('updateChild changes name, allergies and the night-sleep window', async () => {
      const api = createDemoSettingsApi()
      await api.updateChild(auth, {
        childId: IVY_ID, name: 'Ivy Rose', birthday: '2023-04-10', color: '#C2477A',
        allergies: 'Peanuts', foodRules: 'No honey', nightSleep: { start: '19:30', end: '06:30' },
      })
      const ivy = getDemoSnapshot(new Date()).children.find((c) => c.id === IVY_ID)
      expect(ivy).toMatchObject({
        name: 'Ivy Rose', allergies: 'Peanuts', foodRules: 'No honey', nightSleep: { start: '19:30', end: '06:30' },
      })
    })

    it('updateChild for an unknown child throws', async () => {
      const api = createDemoSettingsApi()
      await expect(
        api.updateChild(auth, { childId: 'nope', name: 'X', birthday: '2024-01-01', color: '#000000', allergies: '', foodRules: '', nightSleep: null }),
      ).rejects.toBeInstanceOf(SettingsError)
    })

    it('setFeatureOverride sets and clears a feature override', async () => {
      const api = createDemoSettingsApi()
      await api.setFeatureOverride(auth, IVY_ID, 'kidsCorner', false)
      expect(getDemoSnapshot(new Date()).children.find((c) => c.id === IVY_ID)?.overrides).toEqual({ kidsCorner: false })

      await api.setFeatureOverride(auth, IVY_ID, 'kidsCorner', null)
      expect(getDemoSnapshot(new Date()).children.find((c) => c.id === IVY_ID)?.overrides).toEqual({})
    })
  })

  describe('routines', () => {
    it('upsertRoutine creates a new routine for a null id', async () => {
      const api = createDemoSettingsApi()
      const steps = [{ iconKey: 'bath', photoId: null, label: 'Bath', time: '18:15' }]
      const id = await api.upsertRoutine(auth, { routineId: null, childId: IVY_ID, name: 'Grandma day', weekdays: [3], steps })
      const routine = getDemoSnapshot(new Date()).routines.find((r) => r.id === id)
      expect(routine).toMatchObject({ childId: IVY_ID, name: 'Grandma day', weekdays: [3], steps })
    })

    it('upsertRoutine updates an existing routine in place', async () => {
      const api = createDemoSettingsApi()
      await api.upsertRoutine(auth, { routineId: HOMEDAY_ROUTINE, childId: IVY_ID, name: 'Home day (updated)', weekdays: [1, 2, 3, 4, 5], steps: [] })
      const snapshot = getDemoSnapshot(new Date())
      expect(snapshot.routines.find((r) => r.id === HOMEDAY_ROUTINE)?.name).toBe('Home day (updated)')
      expect(snapshot.routines).toHaveLength(2)
    })

    it('deleteRoutine removes the routine and its progress/day overrides', async () => {
      const api = createDemoSettingsApi()
      await api.setRoutineDayOverride(auth, IVY_ID, '2026-09-20', HOMEDAY_ROUTINE)
      await api.deleteRoutine(auth, HOMEDAY_ROUTINE)
      const snapshot = getDemoSnapshot(new Date())
      expect(snapshot.routines.find((r) => r.id === HOMEDAY_ROUTINE)).toBeUndefined()
      expect(snapshot.routineProgress.find((p) => p.routineId === HOMEDAY_ROUTINE)).toBeUndefined()
      expect(snapshot.routineOverrides.find((o) => o.routineId === HOMEDAY_ROUTINE)).toBeUndefined()
    })

    it('setRoutineDayOverride sets then clears the override for a day', async () => {
      const api = createDemoSettingsApi()
      await api.setRoutineDayOverride(auth, IVY_ID, '2026-09-20', HOMEDAY_ROUTINE)
      expect(getDemoSnapshot(new Date()).routineOverrides).toContainEqual({ childId: IVY_ID, day: '2026-09-20', routineId: HOMEDAY_ROUTINE })

      await api.setRoutineDayOverride(auth, IVY_ID, '2026-09-20', null)
      expect(getDemoSnapshot(new Date()).routineOverrides.find((o) => o.day === '2026-09-20')).toBeUndefined()
    })
  })

  describe('medicines', () => {
    it('upsertMedicine adds a new medicine', async () => {
      const api = createDemoSettingsApi()
      const id = await api.upsertMedicine(auth, { medicineId: null, childId: THEO_ID, name: 'Allergy drops', minIntervalHours: 12, maxDosesPer24h: 2 })
      const medicine = getDemoSnapshot(new Date()).medicines.find((m) => m.id === id)
      expect(medicine).toMatchObject({ childId: THEO_ID, name: 'Allergy drops', minIntervalHours: 12, maxDosesPer24h: 2 })
    })

    it('upsertMedicine updates an existing medicine', async () => {
      const api = createDemoSettingsApi()
      await api.upsertMedicine(auth, { medicineId: IBUPROFEN_THEO, childId: THEO_ID, name: 'Infant ibuprofen (updated)', minIntervalHours: 8, maxDosesPer24h: 3 })
      const medicine = getDemoSnapshot(new Date()).medicines.find((m) => m.id === IBUPROFEN_THEO)
      expect(medicine).toMatchObject({ name: 'Infant ibuprofen (updated)', minIntervalHours: 8, maxDosesPer24h: 3 })
    })

    it('archiveMedicine removes it from the list (matching the server, which never loads archived rows)', async () => {
      const api = createDemoSettingsApi()
      await api.archiveMedicine(auth, IBUPROFEN_THEO)
      expect(getDemoSnapshot(new Date()).medicines.find((m) => m.id === IBUPROFEN_THEO)).toBeUndefined()
    })
  })

  describe('sticker categories', () => {
    it('upsertStickerCategory appends a new category with the next sort order', async () => {
      const api = createDemoSettingsApi()
      const before = getDemoSnapshot(new Date()).stickerCategories
      const id = await api.upsertStickerCategory(auth, { categoryId: null, name: 'Reading', iconKey: 'book', sortOrder: null })
      const categories = getDemoSnapshot(new Date()).stickerCategories
      expect(categories).toHaveLength(before.length + 1)
      expect(categories.at(-1)).toMatchObject({ id, name: 'Reading', iconKey: 'book', sortOrder: before.length })
    })

    it('archiveStickerCategory removes it from the list', async () => {
      const api = createDemoSettingsApi()
      const categoryId = getDemoSnapshot(new Date()).stickerCategories[0]!.id
      await api.archiveStickerCategory(auth, categoryId)
      expect(getDemoSnapshot(new Date()).stickerCategories.find((c) => c.id === categoryId)).toBeUndefined()
    })
  })

  it('deleteOldEntries removes matching jots and returns the count removed', async () => {
    const api = createDemoSettingsApi()
    const count = await api.deleteOldEntries(auth, 'jots', '2100-01-01T00:00:00Z')
    expect(count).toBeGreaterThan(0)
    expect(getDemoSnapshot(new Date()).jots).toHaveLength(0)
  })

  describe('listEntries', () => {
    it('reads feedings newest first', async () => {
      const api = createDemoSettingsApi()
      const rows = await api.listEntries({ table: 'feeding_entries', limit: 10 })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]).toMatchObject({ childId: THEO_ID })
    })

    it('filters by childId', async () => {
      const api = createDemoSettingsApi()
      const rows = await api.listEntries({ table: 'dose_entries', childId: THEO_ID, limit: 10 })
      expect(rows.every((r) => r.childId === THEO_ID)).toBe(true)
    })

    it('does not require a PIN (it is a read)', async () => {
      const api = createDemoSettingsApi()
      await expect(api.listEntries({ table: 'sleep_entries', limit: 10 })).resolves.not.toThrow
    })
  })

  describe('full sign-in only methods', () => {
    it('createMemberInvite, acceptMemberInvite, removeMember, leaveHousehold and deleteHousehold are not available', async () => {
      const api = createDemoSettingsApi()
      const fakeAdultClient = {} as never
      await expect(api.createMemberInvite(fakeAdultClient, 'household-1', 'adult')).rejects.toMatchObject({ message: 'Not available in demo', code: 'other' })
      await expect(api.acceptMemberInvite(fakeAdultClient, { token: 't', displayName: 'X', color: '#000', pin: '1111' })).rejects.toBeInstanceOf(SettingsError)
      await expect(api.removeMember(fakeAdultClient, SAM_ID)).rejects.toBeInstanceOf(SettingsError)
      await expect(api.leaveHousehold(fakeAdultClient, 'household-1')).rejects.toBeInstanceOf(SettingsError)
      await expect(api.deleteHousehold(fakeAdultClient, 'household-1', 'Rivera')).rejects.toBeInstanceOf(SettingsError)
    })

    it('setMemberRole mutates the demo household', async () => {
      const api = createDemoSettingsApi()
      await api.setMemberRole({} as never, ALEX_ID, 'owner')
      expect(getDemoSnapshot(new Date()).members.find((m) => m.id === ALEX_ID)?.role).toBe('owner')
    })

    it('renameDisplay mutates the demo display name', async () => {
      const api = createDemoSettingsApi()
      expect(getDemoDisplayName()).toBe('Kitchen')
      await api.renameDisplay({} as never, 'demo-display', 'Living room')
      expect(getDemoDisplayName()).toBe('Living room')
    })
  })
})
