/** Shared fakes and DOM helpers for log sheet component tests. */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { requiresOnline, type LogCommand } from '@/data/logCommands'
import type { LogWriter } from '@/data/logWriter'
import type { OfflineQueue, QueuedCommand } from '@/data/offlineQueue'

export interface FakeWriter extends LogWriter {
  calls: LogCommand[]
  failNextWith: Error | null
}

export function createFakeWriter(): FakeWriter {
  const writer: FakeWriter = {
    calls: [],
    failNextWith: null,
    async execute(cmd) {
      writer.calls.push(cmd)
      if (writer.failNextWith) {
        const e = writer.failNextWith
        writer.failNextWith = null
        throw e
      }
    },
    async verifyPin() {
      return true
    },
  }
  return writer
}

export function createFakeQueue(): OfflineQueue {
  let items: QueuedCommand[] = []
  let nextKey = 1
  return {
    async enqueue(cmd) {
      if (requiresOnline(cmd)) throw new Error('requires online')
      const key = nextKey++
      items = [...items, { key, command: JSON.parse(JSON.stringify(cmd)), enqueuedAt: new Date().toISOString() }]
      return key
    },
    async list() {
      return items
    },
    async remove(key) {
      items = items.filter((i) => i.key !== key)
    },
    async count() {
      return items.length
    },
    async clear() {
      items = []
    },
  }
}

export const button = (w: VueWrapper, label: string) => {
  const found = w.findAll('button').find((b) => b.text() === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}
export const radio = (w: VueWrapper, group: string, label: string) => {
  const found = w.get(`[role="radiogroup"][aria-label="${group}"]`).findAll('[role="radio"]').find((r) => r.text().includes(label))
  if (!found) throw new Error(`No radio "${label}" in ${group}`)
  return found
}
export const checked = (w: VueWrapper, group: string) =>
  w
    .get(`[role="radiogroup"][aria-label="${group}"]`)
    .findAll('[role="radio"]')
    .filter((r) => r.attributes('aria-checked') === 'true')
    .map((r) => r.text())

export async function click(el: { trigger: (e: string) => Promise<void> }) {
  await el.trigger('click')
  await flushPromises()
}
