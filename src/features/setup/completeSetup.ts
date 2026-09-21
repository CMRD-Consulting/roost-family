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

/** A registered display's claim token, kept so a retry after a failed claim does not register again. */
export interface PendingDisplayClaim {
  token: string
  /** Epoch ms after which the token should be treated as expired. */
  expiresAt: number
}

/** What a previous, partly successful attempt already did. `completeSetup` writes these as it goes. */
export interface SetupProgress {
  householdId: string | null
  displayClaim: PendingDisplayClaim | null
}

/** Claim tokens expire 10 minutes after registration on the server; keep a margin for clock skew. */
export const CLAIM_TOKEN_TTL_MS = 10 * 60_000
export const CLAIM_TOKEN_MARGIN_MS = 30_000

type AdultClient = Pick<AdultSession['client'], 'rpc'>

/**
 * Creates the household (with kids and the owner's PIN) in one transaction, registers this tablet,
 * claims it with the display session, and only then ends the adult session.
 *
 * Retryable: the household id and claim token are recorded on `progress` as soon as they exist, so
 * calling again after a failure skips the household and reuses an unexpired token.
 */
export async function completeSetup(
  progress: SetupInput & SetupProgress,
  adult: Pick<AdultSession, 'end'> & { client: AdultClient },
  claim: (token: string) => Promise<DisplayIdentity>,
  now: () => number = Date.now,
): Promise<DisplayIdentity> {
  if (!progress.householdId) {
    const { data, error } = await adult.client.rpc('setup_household', {
      p_name: progress.householdName.trim(),
      p_time_zone: progress.timeZone,
      p_zip: progress.zip,
      // The SQL function accepts null (location is optional); the CLI types every
      // argument without a default as non-nullable.
      p_lat: progress.lat as number,
      p_lon: progress.lon as number,
      p_invite_code: progress.inviteCode.trim().toUpperCase(),
      p_display_name: progress.displayName.trim(),
      p_color: progress.color,
      p_kids: progress.kids.map((k) => ({ name: k.name.trim(), birthday: k.birthday, color: k.color })),
      p_pin: progress.pin,
    })
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Household setup returned no household')
    progress.householdId = data
  }

  if (!progress.displayClaim || progress.displayClaim.expiresAt <= now()) {
    progress.displayClaim = null
    const registeredAt = now()
    const { data, error } = await adult.client.rpc('register_display', {
      p_household_id: progress.householdId,
      p_name: progress.displayLabel.trim(),
    })
    if (error) throw new Error(error.message)
    const token = data?.[0]?.out_claim_token
    if (!token) throw new Error('Display registration returned no token')
    progress.displayClaim = { token, expiresAt: registeredAt + CLAIM_TOKEN_TTL_MS - CLAIM_TOKEN_MARGIN_MS }
  }

  const identity = await claim(progress.displayClaim.token)
  await adult.end()
  return identity
}

/** Wording for a failed `register_display` or `reconnect_display`; the server's messages are written for logs, not
 *  people. */
export function joinDisplayErrorMessage(serverMessage: string, householdName: string): string {
  if (/at most \d+ displays/i.test(serverMessage)) {
    return `${householdName} already has 3 displays. Reconnect this tablet as one of them, or remove one in Settings → Displays or at roost.cmrd.dev/manage, then try again.`
  }
  if (/display not found/i.test(serverMessage)) {
    return 'That display isn’t available any more. Pick another, or add this tablet as a new display.'
  }
  return serverMessage
}

export function isInvalidInviteError(error: unknown): boolean {
  return error instanceof Error && /invalid invite code/i.test(error.message)
}

/** True when the signed-in adult already owns an active household. */
export async function adultOwnsHousehold(adult: Pick<AdultSession, 'client' | 'userId'>): Promise<boolean> {
  const { data, error } = await adult.client
    .from('memberships')
    .select('id')
    .eq('user_id', adult.userId)
    .eq('role', 'owner')
    .is('left_at', null)
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}
