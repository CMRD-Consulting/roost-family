import { applyCommand } from '../applyCommand'
import type { LogCommand } from '../logCommands'
import { LogWriteError, type LogWriter } from '../logWriter'
import { getDemoSnapshot, mutateDemo } from './demoHousehold'

/** Simulated network latency, so optimistic UI has something to be optimistic about. */
const DELAY_MS = 150

/** Membership id -> PIN, for the two demo adults. */
const DEMO_PINS: Record<string, string> = {
  'bbbbbbbb-0000-0000-0000-000000000001': '1234', // Sam
  'bbbbbbbb-0000-0000-0000-000000000002': '5678', // Alex
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pinOk(membershipId: string, pin: string): boolean {
  return DEMO_PINS[membershipId] === pin
}

/** Demo-mode LogWriter: applies commands to the shared in-memory demo household. */
export function createDemoLogWriter(): LogWriter {
  async function execute(cmd: LogCommand): Promise<void> {
    await delay(DELAY_MS)
    // Voiding and acknowledging doses and starting and ending Sitter Mode all carry an adult's PIN.
    if ('pin' in cmd && !pinOk(cmd.membershipId, cmd.pin)) {
      throw new LogWriteError('Wrong PIN', false, '42501')
    }
    // Sitter conflicts, like the server: a retried start with the same id is fine; ending needs the open session.
    if (cmd.kind === 'sitter.start') {
      const active = getDemoSnapshot(new Date()).activeSitterSession
      if (active !== null && active.id !== cmd.sessionId) throw new LogWriteError('a sitter session is already active', false, '23505')
    }
    if (cmd.kind === 'sitter.end') {
      const s = getDemoSnapshot(new Date())
      if (s.activeSitterSession?.id !== cmd.sessionId) {
        if (s.recentSitterSession?.id === cmd.sessionId) throw new LogWriteError('sitter session has already ended', false, '22023')
        throw new LogWriteError('sitter session not found', false, '42501')
      }
    }
    mutateDemo((s) => applyCommand(s, cmd, new Date()))
  }

  async function verifyPin(membershipId: string, pin: string): Promise<boolean> {
    return pinOk(membershipId, pin)
  }

  return { execute, verifyPin }
}
