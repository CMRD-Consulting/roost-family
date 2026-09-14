/**
 * Take list (spec §7.8): a 24-hour private link that carries the grocery list to a phone.
 *
 * - Display side (`TakeListDisplayApi`): runs on the display's own client; any household member or display can
 *   create the link (which revokes the previous one) or end it.
 * - Phone page (`TakeListPageApi`): runs on a separate anon client with no session; every call carries the token,
 *   and the server only ever returns grocery items.
 */
import { isDemo } from './householdSource'
import type { RoostClient } from './supabase'

export type TakeListErrorCode = 'denied' | 'invalid' | 'network' | 'other'

/** `denied`: the link expired, was revoked or never existed (or the caller isn't a member). `invalid`: bad input,
 *  e.g. an item that was deleted at home. `network`: no response, a timeout, or a server/gateway failure. */
export class TakeListError extends Error {
  constructor(
    message: string,
    readonly code: TakeListErrorCode,
  ) {
    super(message)
    this.name = 'TakeListError'
  }
}

export interface TakeListLink {
  token: string
  expiresAt: string
}

export interface TakeListItem {
  id: string
  text: string
  checked: boolean
}

export interface TakeListDisplayApi {
  createLink(householdId: string): Promise<TakeListLink>
  revoke(householdId: string): Promise<void>
}

export interface TakeListPageApi {
  items(token: string): Promise<TakeListItem[]>
  setChecked(token: string, itemId: string, checked: boolean): Promise<void>
  done(token: string): Promise<void>
}

export function takeListUrl(origin: string, token: string): string {
  return `${origin}/list/${token}`
}

type RpcResult = { error: { message: string; code?: string } | null; data?: unknown; status?: number }

function classify(status: number | null, code: string | null): TakeListErrorCode {
  if (code === '42501') return 'denied'
  if (code === '22023') return 'invalid'
  if (status === null && code === null) return 'network'
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return 'network'
  if (code?.startsWith('PGRST3')) return 'network'
  return 'other'
}

async function run<T>(op: () => PromiseLike<RpcResult>): Promise<T> {
  let result: RpcResult
  try {
    result = await op()
  } catch (e) {
    throw new TakeListError(e instanceof Error ? e.message : String(e), 'network')
  }
  if (result.error) {
    throw new TakeListError(result.error.message, classify(result.status || null, result.error.code || null))
  }
  return result.data as T
}

export function createTakeListDisplayApi(client: RoostClient): TakeListDisplayApi {
  return {
    async createLink(householdId) {
      const rows = await run<{ out_token: string; out_expires_at: string }[] | null>(() =>
        client.rpc('create_take_list_link', { p_household_id: householdId }),
      )
      const row = rows?.[0]
      if (!row) throw new TakeListError('No take list link was returned', 'other')
      return { token: row.out_token, expiresAt: row.out_expires_at }
    },
    async revoke(householdId) {
      await run(() => client.rpc('revoke_take_list_link', { p_household_id: householdId }))
    },
  }
}

export function createTakeListPageApi(client: RoostClient): TakeListPageApi {
  return {
    async items(token) {
      const rows = await run<{ out_id: string; out_text: string; out_checked: boolean }[] | null>(() =>
        client.rpc('take_list_items', { p_token: token }),
      )
      return (rows ?? []).map((r) => ({ id: r.out_id, text: r.out_text, checked: r.out_checked }))
    },
    async setChecked(token, itemId, checked) {
      await run(() => client.rpc('take_list_set_checked', { p_token: token, p_item_id: itemId, p_checked: checked }))
    },
    async done(token) {
      await run(() => client.rpc('take_list_done', { p_token: token }))
    },
  }
}

/** In the offline demo there is no server: the QR sheet still shows a (non-working) link. */
function createDemoTakeListDisplayApi(): TakeListDisplayApi {
  return {
    async createLink() {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return { token, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }
    },
    async revoke() {},
  }
}

/** The display's API, on the display's own client (loaded lazily so the Supabase client isn't built in tests). */
export async function loadTakeListDisplayApi(): Promise<TakeListDisplayApi> {
  if (isDemo) return createDemoTakeListDisplayApi()
  const { displayClient } = await import('./supabase')
  return createTakeListDisplayApi(displayClient)
}

/** The phone page's API, on its own session-less anon client: it never touches the display's session. */
export async function loadTakeListPageApi(): Promise<TakeListPageApi> {
  const { createAnonClient } = await import('./sessionlessClients')
  return createTakeListPageApi(createAnonClient())
}
