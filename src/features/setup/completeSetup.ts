import type { AdultSession } from '@/session/adultSession'
import type { DisplayIdentity } from '@/session/displaySession'
import type { KidDraft } from './wizardState'

export interface SetupInput {
  inviteCode: string
  householdName: string
  zip: string
  timeZone: string
  lat: number | null
  lon: number | null
  kids: KidDraft[]
  displayName: string
  color: string
  pin: string
  displayLabel: string
}

type RpcResult<T> = { data: T; error: { message: string } | null }

function unwrap<T>(result: RpcResult<T>): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/**
 * Writes the household with the adult's temporary session, registers this tablet,
 * claims it with the display session, and ends the adult session.
 */
export async function completeSetup(
  input: SetupInput,
  adult: AdultSession,
  claim: (token: string) => Promise<DisplayIdentity>,
): Promise<DisplayIdentity> {
  const rpc = adult.client.rpc.bind(adult.client) as unknown as (fn: string, args?: object) => Promise<RpcResult<unknown>>

  const householdId = unwrap(
    await rpc('create_household', {
      p_name: input.householdName.trim(),
      p_time_zone: input.timeZone,
      p_zip: input.zip,
      p_lat: input.lat,
      p_lon: input.lon,
      p_invite_code: input.inviteCode.trim().toUpperCase(),
      p_display_name: input.displayName.trim(),
      p_color: input.color,
    }),
  ) as string

  for (const kid of input.kids) {
    unwrap(
      await rpc('add_child', {
        p_household_id: householdId,
        p_name: kid.name.trim(),
        p_birthday: kid.birthday,
        p_color: kid.color,
      }),
    )
  }

  unwrap(await rpc('set_my_pin', { p_household_id: householdId, p_pin: input.pin }))

  const rows = unwrap(
    await rpc('register_display', { p_household_id: householdId, p_name: input.displayLabel.trim() }),
  ) as { out_display_id: string; out_claim_token: string }[]
  const token = rows[0]?.out_claim_token
  if (!token) throw new Error('Display registration returned no token')

  const identity = await claim(token)
  await adult.end()
  return identity
}
