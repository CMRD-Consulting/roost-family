import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ExportError, type ExportStatus } from '@/data/exportApi'
import ExportDownload, { type ExportDownloadApi } from './ExportDownload.vue'

const adult = vi.hoisted(() => {
  let n = 0
  return {
    newAdultClient: vi.fn(() => ({ name: `client-${++n}` })),
    sendEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    disposeAdultClient: vi.fn(),
    resetClients: () => (n = 0),
  }
})

vi.mock('@/data/householdSource', () => ({ isDemo: false }))
vi.mock('@/session/adultSession', () => adult)
vi.mock('@/data/supabase', () => {
  throw new Error('Display Supabase client loaded by the export download page')
})

const EXPORT = 'eeeeeeee-0000-0000-0000-000000000001'
const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const URL_ = `http://127.0.0.1:55321/storage/v1/object/sign/exports/${HOUSEHOLD}/${EXPORT}.zip?token=t`

const READY: ExportStatus = {
  id: EXPORT, householdId: HOUSEHOLD, status: 'ready', expired: false, createdAt: '2026-09-14T18:00:00Z',
  readyAt: '2026-09-14T18:01:00Z', expiresAt: '2026-09-15T18:01:00Z',
}

let api: { exportStatus: ReturnType<typeof vi.fn>; exportDownloadUrl: ReturnType<typeof vi.fn> } & ExportDownloadApi
let assign: ReturnType<typeof vi.fn<(url: string) => void>>
const ended: string[] = []

async function settle() {
  await vi.advanceTimersByTimeAsync(50)
  for (let i = 0; i < 10; i++) await flushPromises()
}

function buttonByText(w: Pick<VueWrapper, 'findAll'>, text: string) {
  const found = w.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

function inputByLabel(w: VueWrapper, label: string) {
  const lab = w.findAll('label').find((l) => l.text() === label)
  if (!lab) throw new Error(`No label "${label}"`)
  return w.find(`#${CSS.escape(lab.attributes('for')!)}`)
}

async function mountPage(id = EXPORT, extra: Record<string, unknown> = {}): Promise<VueWrapper> {
  const Stub = defineComponent({ render: () => h('p', 'stub') })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/manage', component: Stub }, { path: '/manage/export/:id', component: Stub }],
  })
  await router.push(`/manage/export/${id}`)
  await router.isReady()
  const w = mount(ExportDownload, { props: { id, api, assign, ...extra }, global: { plugins: [router] }, attachTo: document.body })
  await settle()
  return w
}

async function signIn(w: VueWrapper, email = 'sam@example.com') {
  await inputByLabel(w, 'Email').setValue(email)
  await buttonByText(w, 'Email me a 6-digit code').trigger('click')
  await settle()
  await inputByLabel(w, '6-digit code').setValue('123456')
  await buttonByText(w, 'Sign in').trigger('click')
  await settle()
}

const heading = (w: VueWrapper) => w.find('h1')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-14T19:00:00Z'))
  ended.length = 0
  adult.resetClients()
  adult.sendEmailCode.mockReset().mockResolvedValue(undefined)
  adult.disposeAdultClient.mockReset().mockResolvedValue(undefined)
  adult.verifyEmailCode.mockReset().mockImplementation(async (client: { name: string }, email: string) => ({
    client, userId: `user-${email}`, email, end: vi.fn(async () => void ended.push(client.name)),
  }))
  api = { exportStatus: vi.fn().mockResolvedValue(READY), exportDownloadUrl: vi.fn().mockResolvedValue(URL_) } as never
  assign = vi.fn<(url: string) => void>()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('ExportDownload', () => {
  it('asks for a sign-in first and reads nothing before it', async () => {
    const w = await mountPage()
    expect(heading(w).text()).toBe('Download your export')
    expect(api.exportStatus).not.toHaveBeenCalled()
    w.unmount()
  })

  it('once signed in, loads the export on the adult’s client and downloads it through a signed URL in this page', async () => {
    const w = await mountPage()
    await signIn(w)
    expect(api.exportStatus).toHaveBeenCalledWith({ name: 'client-1' }, EXPORT)
    expect(heading(w).text()).toBe('Your export is ready')
    expect(document.activeElement).toBe(heading(w).element)

    const download = buttonByText(w, 'Download export')
    await download.trigger('click')
    await settle()
    expect(api.exportDownloadUrl).toHaveBeenCalledWith({ name: 'client-1' }, EXPORT)
    expect(assign).toHaveBeenCalledWith(URL_)
    w.unmount()
    expect(ended).toEqual(['client-1'])
  })

  it('says the export isn’t available to a non-owner, or when there is no such export', async () => {
    api.exportStatus.mockRejectedValue(new ExportError('not_found'))
    const w = await mountPage()
    await signIn(w)
    expect(heading(w).text()).toBe('This export isn’t available to you')
    expect(w.findAll('button').map((b) => b.text())).not.toContain('Download export')
    w.unmount()
  })

  it('shows a malformed link as not available, without asking the server', async () => {
    const w = await mountPage('not-an-id')
    await signIn(w)
    expect(heading(w).text()).toBe('This export isn’t available to you')
    expect(api.exportStatus).not.toHaveBeenCalled()
    w.unmount()
  })

  it('shows a pending export as still preparing, and refreshes', async () => {
    api.exportStatus.mockResolvedValueOnce({ ...READY, status: 'pending', readyAt: null })
    const w = await mountPage()
    await signIn(w)
    expect(heading(w).text()).toBe('Still preparing…')
    await buttonByText(w, 'Refresh').trigger('click')
    await settle()
    expect(api.exportStatus).toHaveBeenCalledTimes(2)
    expect(heading(w).text()).toBe('Your export is ready')
    w.unmount()
  })

  it('offers a new request from Manage household for failed and expired exports', async () => {
    for (const [row, title] of [
      [{ ...READY, status: 'failed' as const, readyAt: null }, 'This export didn’t finish'],
      [{ ...READY, expired: true }, 'This export has expired'],
    ] as const) {
      api.exportStatus.mockResolvedValueOnce(row)
      const w = await mountPage()
      await signIn(w)
      expect(heading(w).text()).toBe(title)
      const link = w.find('a[href="/manage"]')
      expect(link.text()).toBe('Request a new export')
      w.unmount()
    }
  })

  it('follows the state the download finds: expired since the page loaded', async () => {
    api.exportDownloadUrl.mockRejectedValue(new ExportError('expired'))
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Download export').trigger('click')
    await settle()
    expect(heading(w).text()).toBe('This export has expired')
    expect(assign).not.toHaveBeenCalled()
    w.unmount()
  })

  it('shows a lost connection on download without leaving the page, and a load failure with Try again', async () => {
    api.exportDownloadUrl.mockRejectedValueOnce(new ExportError('network'))
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Download export').trigger('click')
    await settle()
    expect(heading(w).text()).toBe('Your export is ready')
    expect(w.find('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
    w.unmount()

    api.exportStatus.mockRejectedValueOnce(new ExportError('network'))
    const again = await mountPage()
    await signIn(again)
    expect(again.find('[role="alert"]').text()).toBe('Couldn’t reach Roost Family. Check the connection and try again.')
    await buttonByText(again, 'Try again').trigger('click')
    await settle()
    expect(heading(again).text()).toBe('Your export is ready')
    again.unmount()
  })

  it('goes back to sign-in when the sign-in ended, and signs out on request', async () => {
    api.exportDownloadUrl.mockRejectedValueOnce(new ExportError('session', null, 401))
    const w = await mountPage()
    await signIn(w)
    await buttonByText(w, 'Download export').trigger('click')
    await settle()
    expect(heading(w).text()).toBe('Download your export')
    expect(w.text()).toContain('Your sign-in ended. Sign in again.')
    expect(ended).toEqual(['client-1'])

    await signIn(w)
    await buttonByText(w, 'Sign out').trigger('click')
    await settle()
    expect(heading(w).text()).toBe('Download your export')
    expect(ended).toEqual(['client-1', 'client-2'])
    w.unmount()
  })

  it('signs out after 5 minutes without a touch', async () => {
    const w = await mountPage(EXPORT, { idleMs: 1000 })
    await signIn(w)
    await vi.advanceTimersByTimeAsync(1500)
    await settle()
    expect(heading(w).text()).toBe('Download your export')
    expect(w.text()).toContain('Signed out after 5 minutes without a touch.')
    expect(ended).toEqual(['client-1'])
    w.unmount()
  })
})
