import { describe, expect, it } from 'vitest'
import type { RoostClient } from './supabase'
import { TakeListError, createTakeListDisplayApi, createTakeListPageApi, takeListUrl } from './takeListApi'

type Resp = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

function fakeClient(responses: Record<string, Resp> = {}, opts: { throws?: boolean } = {}) {
  const calls: Array<{ name: string; args: unknown }> = []
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args })
      if (opts.throws) return Promise.reject(new TypeError('fetch failed'))
      return Promise.resolve(responses[name] ?? { error: null, data: null, status: 204 })
    },
  } as unknown as RoostClient
  return { client, calls }
}

const HOUSEHOLD = 'aaaaaaaa-0000-0000-0000-000000000001'
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

async function errorOf(p: Promise<unknown>): Promise<TakeListError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(e).toBeInstanceOf(TakeListError)
  return e as TakeListError
}

describe('takeListUrl', () => {
  it('builds the phone page URL from the origin and token', () => {
    expect(takeListUrl('https://roost.cmrd.dev', TOKEN)).toBe(`https://roost.cmrd.dev/list/${TOKEN}`)
  })
})

describe('createTakeListDisplayApi', () => {
  it('creates a link for the household and returns its token and expiry', async () => {
    const { client, calls } = fakeClient({
      create_take_list_link: { error: null, data: [{ out_token: TOKEN, out_expires_at: '2026-09-15T19:00:00+00:00' }], status: 200 },
    })
    const link = await createTakeListDisplayApi(client).createLink(HOUSEHOLD)
    expect(link).toEqual({ token: TOKEN, expiresAt: '2026-09-15T19:00:00+00:00' })
    expect(calls).toEqual([{ name: 'create_take_list_link', args: { p_household_id: HOUSEHOLD } }])
  })

  it('throws when no link row comes back', async () => {
    const { client } = fakeClient({ create_take_list_link: { error: null, data: [], status: 200 } })
    expect((await errorOf(createTakeListDisplayApi(client).createLink(HOUSEHOLD))).code).toBe('other')
  })

  it('revokes the household link', async () => {
    const { client, calls } = fakeClient()
    await createTakeListDisplayApi(client).revoke(HOUSEHOLD)
    expect(calls).toEqual([{ name: 'revoke_take_list_link', args: { p_household_id: HOUSEHOLD } }])
  })

  it('classifies a thrown fetch as a network error', async () => {
    const { client } = fakeClient({}, { throws: true })
    expect((await errorOf(createTakeListDisplayApi(client).createLink(HOUSEHOLD))).code).toBe('network')
  })
})

describe('createTakeListPageApi', () => {
  it('lists items with the token', async () => {
    const { client, calls } = fakeClient({
      take_list_items: {
        error: null,
        status: 200,
        data: [
          { out_id: 'g1', out_text: 'Milk', out_checked: false },
          { out_id: 'g2', out_text: 'Apples', out_checked: true },
        ],
      },
    })
    const items = await createTakeListPageApi(client).items(TOKEN)
    expect(items).toEqual([
      { id: 'g1', text: 'Milk', checked: false },
      { id: 'g2', text: 'Apples', checked: true },
    ])
    expect(calls).toEqual([{ name: 'take_list_items', args: { p_token: TOKEN } }])
  })

  it('checks an item and finishes the list with the token', async () => {
    const { client, calls } = fakeClient()
    const api = createTakeListPageApi(client)
    await api.setChecked(TOKEN, 'g1', true)
    await api.done(TOKEN)
    expect(calls).toEqual([
      { name: 'take_list_set_checked', args: { p_token: TOKEN, p_item_id: 'g1', p_checked: true } },
      { name: 'take_list_done', args: { p_token: TOKEN } },
    ])
  })

  it('maps an expired or revoked link (42501) to denied', async () => {
    const { client } = fakeClient({
      take_list_items: { error: { message: 'this list has expired', code: '42501' }, status: 401 },
    })
    const e = await errorOf(createTakeListPageApi(client).items(TOKEN))
    expect(e.code).toBe('denied')
    expect(e.message).toBe('this list has expired')
  })

  it('maps a missing item (22023) to invalid', async () => {
    const { client } = fakeClient({ take_list_set_checked: { error: { message: 'item not found', code: '22023' }, status: 400 } })
    expect((await errorOf(createTakeListPageApi(client).setChecked(TOKEN, 'gone', true))).code).toBe('invalid')
  })

  it('maps failed requests and server errors to network', async () => {
    const aborted = fakeClient({ take_list_done: { error: { message: 'AbortError: Request timed out', code: '' }, status: 0 } })
    expect((await errorOf(createTakeListPageApi(aborted.client).done(TOKEN))).code).toBe('network')
    const gateway = fakeClient({ take_list_done: { error: { message: 'Bad gateway' }, status: 502 } })
    expect((await errorOf(createTakeListPageApi(gateway.client).done(TOKEN))).code).toBe('network')
  })
})
