import { createAdultClient, type RoostClient } from '@/data/supabase'

export interface AdultSession {
  client: RoostClient
  userId: string
  email: string
  end: () => Promise<void>
}

export function newAdultClient(): RoostClient {
  return createAdultClient()
}

export async function sendEmailCode(client: RoostClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  if (error) throw error
}

export async function verifyEmailCode(client: RoostClient, email: string, code: string): Promise<AdultSession> {
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw error
  if (!data.user) throw new Error('Sign-in did not return a user')
  return {
    client,
    userId: data.user.id,
    email: data.user.email ?? email,
    end: async () => {
      await client.auth.signOut({ scope: 'local' })
      client.auth.stopAutoRefresh()
    },
  }
}
