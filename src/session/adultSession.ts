import { markRaw, type Raw } from 'vue'
import { createAdultClient } from '@/data/sessionlessClients'
import type { RoostClient } from '@/data/supabase'

export interface AdultSession {
  /** Raw so storing the session in reactive state never proxies the Supabase client. */
  client: Raw<RoostClient>
  userId: string
  email: string
  /** Signs out locally and tears the client down. Idempotent; never throws. */
  end: () => Promise<void>
}

export const SIGN_OUT_TIMEOUT_MS = 5_000

type DisposableAuth = Pick<RoostClient['auth'], 'stopAutoRefresh' | 'signOut'> & { dispose?: () => Promise<void> | void }

export function newAdultClient(): RoostClient {
  return createAdultClient()
}

/**
 * Stops token refresh, signs out locally (giving up after `SIGN_OUT_TIMEOUT_MS` so an offline tablet
 * never hangs), then disposes the auth client. Never throws.
 */
export async function disposeAdultClient(client: { auth: DisposableAuth }, timeoutMs = SIGN_OUT_TIMEOUT_MS): Promise<void> {
  try {
    await client.auth.stopAutoRefresh()
  } catch {
    // ignore
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.auth.signOut({ scope: 'local' }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } catch {
    // ignore
  } finally {
    clearTimeout(timer)
  }
  try {
    await client.auth.dispose?.()
  } catch {
    // ignore
  }
}

export async function sendEmailCode(client: RoostClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  if (error) throw error
}

export async function verifyEmailCode(client: RoostClient, email: string, code: string): Promise<AdultSession> {
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw error
  if (!data.user) throw new Error('Sign-in did not return a user')
  let ending: Promise<void> | null = null
  return {
    client: markRaw(client),
    userId: data.user.id,
    email: data.user.email ?? email,
    end: () => (ending ??= disposeAdultClient(client)),
  }
}
