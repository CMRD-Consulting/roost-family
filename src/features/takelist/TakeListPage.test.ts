import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { TakeListError, type TakeListItem, type TakeListPageApi } from '@/data/takeListApi'
import TakeListPage from './TakeListPage.vue'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

interface FakePageApi extends TakeListPageApi {
  list: TakeListItem[]
  calls: string[]
  /** The next call to each method fails with this error. */
  failNext: Partial<Record<'items' | 'setChecked' | 'done', TakeListError>>
}

function fakeApi(list: TakeListItem[]): FakePageApi {
  const api: FakePageApi = {
    list,
    calls: [],
    failNext: {},
    async items(token) {
      api.calls.push(`items:${token}`)
      takeFailure('items')
      return api.list.map((i) => ({ ...i }))
    },
    async setChecked(token, itemId, checked) {
      api.calls.push(`setChecked:${token}:${itemId}:${checked}`)
      takeFailure('setChecked')
      api.list = api.list.map((i) => (i.id === itemId ? { ...i, checked } : i))
    },
    async done(token) {
      api.calls.push(`done:${token}`)
      takeFailure('done')
    },
  }
  function takeFailure(method: 'items' | 'setChecked' | 'done') {
    const e = api.failNext[method]
    if (e) {
      delete api.failNext[method]
      throw e
    }
  }
  return api
}

const denied = () => new TakeListError('this list has expired', 'denied')
const network = () => new TakeListError('fetch failed', 'network')

let wrapper: VueWrapper | null = null

async function mountPage(api: TakeListPageApi) {
  wrapper = mount(TakeListPage, { props: { token: TOKEN, api }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const names = (w: VueWrapper) =>
  w.findAll('[role="checkbox"]').map((b) => `${b.get('span:last-child').text()}:${b.attributes('aria-checked')}`)
const buttonNamed = (w: VueWrapper, label: string) => {
  const b = w.findAll('button').find((x) => x.text() === label)
  if (!b) throw new Error(`No button "${label}"`)
  return b
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('TakeListPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    setVisibility('visible')
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('shows loading, then the groceries with checked items at the bottom', async () => {
    const api = fakeApi([
      { id: 'g1', text: 'Milk', checked: false },
      { id: 'g2', text: 'Eggs', checked: false },
      { id: 'g3', text: 'Apples', checked: true },
    ])
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow: TakeListPageApi = { ...api, items: async (t) => (await gate, api.items(t)) }
    wrapper = mount(TakeListPage, { props: { token: TOKEN, api: slow }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.text()).toContain('Loading the list')

    release()
    await flushPromises()
    const w = wrapper
    expect(w.text()).toContain('roost family')
    expect(w.get('h1').text()).toBe('Grocery list')
    expect(names(w)).toEqual(['Milk:false', 'Eggs:false', 'Apples:true'])
    expect(w.findAll('[role="checkbox"]')[2]!.get('.line-through').text()).toBe('Apples')
  })

  it('checks an item off at once, sends it with the token, and moves it to the bottom', async () => {
    const api = fakeApi([
      { id: 'g1', text: 'Milk', checked: false },
      { id: 'g2', text: 'Eggs', checked: false },
    ])
    const w = await mountPage(api)

    await w.findAll('[role="checkbox"]')[0]!.trigger('click')
    expect(names(w)).toEqual(['Eggs:false', 'Milk:true'])
    await flushPromises()
    expect(api.calls).toContain(`setChecked:${TOKEN}:g1:true`)

    await w.findAll('[role="checkbox"]')[1]!.trigger('click')
    await flushPromises()
    expect(api.calls).toContain(`setChecked:${TOKEN}:g1:false`)
    expect(names(w)).toEqual(['Milk:false', 'Eggs:false'])
  })

  it('shows an empty state', async () => {
    const w = await mountPage(fakeApi([]))
    expect(w.text()).toContain('Nothing on the list')
  })

  it('shows the expired state for an expired or revoked link and stops polling', async () => {
    const api = fakeApi([])
    api.failNext.items = denied()
    const w = await mountPage(api)
    expect(w.text()).toContain('This list has expired.')
    expect(w.text()).toContain('Ask for a new one at home.')
    expect(w.find('[role="checkbox"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.calls).toEqual([`items:${TOKEN}`])
  })

  it('becomes expired when a check-off finds the link ended', async () => {
    const api = fakeApi([{ id: 'g1', text: 'Milk', checked: false }])
    const w = await mountPage(api)
    api.failNext.setChecked = denied()
    await w.get('[role="checkbox"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('This list has expired.')
  })

  it('ends the link with Done shopping', async () => {
    const api = fakeApi([{ id: 'g1', text: 'Milk', checked: false }])
    const w = await mountPage(api)
    await buttonNamed(w, 'Done shopping').trigger('click')
    await flushPromises()
    expect(api.calls).toContain(`done:${TOKEN}`)
    expect(w.text()).toContain('All done')
    expect(w.find('[role="checkbox"]').exists()).toBe(false)

    const before = api.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.calls).toHaveLength(before)
  })

  it('polls every 10 seconds while visible, and refreshes when shown again', async () => {
    const api = fakeApi([{ id: 'g1', text: 'Milk', checked: false }])
    const w = await mountPage(api)
    expect(api.calls).toEqual([`items:${TOKEN}`])

    api.list = [...api.list, { id: 'g2', text: 'Bread', checked: false }]
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.calls).toHaveLength(2)
    expect(names(w)).toEqual(['Milk:false', 'Bread:false'])

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.calls).toHaveLength(2)

    setVisibility('visible')
    await flushPromises()
    expect(api.calls).toHaveLength(3)
  })

  it('keeps a check-off made offline, shows the offline banner, and sends it on the next poll', async () => {
    const api = fakeApi([
      { id: 'g1', text: 'Milk', checked: false },
      { id: 'g2', text: 'Eggs', checked: false },
    ])
    const w = await mountPage(api)
    api.failNext.setChecked = network()
    await w.findAll('[role="checkbox"]')[0]!.trigger('click')
    await flushPromises()
    expect(w.get('[role="status"]').text()).toContain('offline')
    expect(names(w)).toEqual(['Eggs:false', 'Milk:true'])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.calls.filter((c) => c.startsWith('setChecked'))).toEqual([
      `setChecked:${TOKEN}:g1:true`,
      `setChecked:${TOKEN}:g1:true`,
    ])
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(names(w)).toEqual(['Eggs:false', 'Milk:true'])
  })

  it('shows the offline banner when the first load fails and loads on the next poll', async () => {
    const api = fakeApi([{ id: 'g1', text: 'Milk', checked: false }])
    api.failNext.items = network()
    const w = await mountPage(api)
    expect(w.text()).toContain('offline')
    expect(w.find('[role="checkbox"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(names(w)).toEqual(['Milk:false'])
  })
})
