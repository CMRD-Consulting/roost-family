import { applyCommand } from '../applyCommand'
import type { LogCommand } from '../logCommands'
import { LogWriteError, type LogWriter } from '../logWriter'
import { mutateDemo } from './demoHousehold'

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
    if ((cmd.kind === 'dose.void' || cmd.kind === 'dose.acknowledge') && !pinOk(cmd.membershipId, cmd.pin)) {
      throw new LogWriteError('Wrong PIN', false, '42501')
    }
    mutateDemo((s) => applyCommand(s, cmd, new Date()))
  }

  async function verifyPin(membershipId: string, pin: string): Promise<boolean> {
    return pinOk(membershipId, pin)
  }

  return { execute, verifyPin }
}
