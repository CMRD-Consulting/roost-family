import { afterEach, describe, expect, it, vi } from 'vitest'

const exportApi = vi.hoisted(() => ({ requestExport: vi.fn(async () => 'export-1') }))
const source = vi.hoisted(() => ({ isDemo: false }))
vi.mock('@/data/exportApi', () => exportApi)
vi.mock('@/data/householdSource', () => source)

afterEach(() => {
  vi.resetModules()
  exportApi.requestExport.mockClear()
})

describe('requestManageExport', () => {
  const target = { client: { name: 'client-1' } as never, householdId: 'household-1', membershipId: 'membership-1' }

  it('requests the export of the household on the owner’s client', async () => {
    source.isDemo = false
    const { requestManageExport } = await import('./manageApi')
    await expect(requestManageExport(target)).resolves.toBeUndefined()
    expect(exportApi.requestExport).toHaveBeenCalledWith(target.client, 'household-1')
  })

  it('is not available in demo mode', async () => {
    source.isDemo = true
    const { requestManageExport } = await import('./manageApi')
    const e = await requestManageExport(target).catch((x: unknown) => x)
    // (Compared by shape: resetModules gives this import its own SettingsError class.)
    expect(e).toMatchObject({ message: 'Not available in demo', code: 'other' })
    expect(exportApi.requestExport).not.toHaveBeenCalled()
  })
})
