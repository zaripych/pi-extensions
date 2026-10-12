import { describe, expect, it, vi } from 'vitest'
import { combineHarnesses } from './combineHarnesses'
import { configureHarnesses } from './configureHarnesses'

type User = {
  id: string
  name: string
}

type LoadUser = () => Promise<User>

it('merges function results from multiple harnesses', async () => {
  const loadUser = async () => ({ id: 'user-1', name: 'Alice' })
  const loadSettings = async () => ({ theme: 'dark' })

  const setupUser = async () => ({ loadUser })
  const setupSettings = async () => ({ loadSettings })

  const setup = combineHarnesses(setupUser, setupSettings)
  await using harness = await setup()

  expect(await harness.loadUser()).toEqual({ id: 'user-1', name: 'Alice' })
  expect(await harness.loadSettings()).toEqual({ theme: 'dark' })
})

it('passes accumulated function results to subsequent harnesses', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'user-1', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup()

  expect(await harness.loadProfile()).toEqual({
    user: { id: 'user-1', name: 'Alice' },
  })
})

it('passes mock-wrapped accumulated functions to subsequent harnesses', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'user-1', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup()

  await harness.loadProfile()

  expect(harness.loadUser).toHaveBeenCalledWith()
})

it('user override functions take priority over harness functions', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'original-user', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup({
    loadUser: async () => ({ id: 'override-user', name: 'Bob' }),
  })

  expect(await harness.loadProfile()).toEqual({
    user: { id: 'override-user', name: 'Bob' },
  })
  expect(await harness.loadUser()).toEqual({ id: 'override-user', name: 'Bob' })
  expect(harness.loadUser).toHaveBeenCalledTimes(2)
})

it('preserves primitive and deny-listed overrides in inputs and the final result', async () => {
  const setupValues = () => ({
    label: 'original',
    items: ['original'],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  })
  const setupConsumer = (deps: ReturnType<typeof setupValues>) => ({
    readValues: () => deps,
  })
  const overrides = {
    label: 'override',
    items: ['override'],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  }

  const setup = combineHarnesses(setupValues, setupConsumer)
  await using harness = await setup(overrides)

  expect(harness.readValues()).toEqual(overrides)
  expect(harness.label).toBe(overrides.label)
  expect(harness.items).toBe(overrides.items)
  expect(harness.createdAt).toBe(overrides.createdAt)
})

it('works with no overrides and no disposables', async () => {
  const setupClock = async () => ({
    getCurrentTime: () => new Date('2024-01-01T00:00:00.000Z'),
  })

  const setup = combineHarnesses(setupClock)
  await using harness = await setup()

  expect(harness.getCurrentTime()).toEqual(new Date('2024-01-01T00:00:00.000Z'))
})

it('accepts a sync harness', async () => {
  const setupClock = () => ({
    getCurrentTime: () => new Date('2024-01-01T00:00:00.000Z'),
  })

  const setup = combineHarnesses(setupClock)
  await using harness = await setup()

  expect(harness.getCurrentTime()).toEqual(new Date('2024-01-01T00:00:00.000Z'))
})

it('runs a repeated harness once per setup call', async () => {
  const setupShared = vi.fn(() => ({ read: () => true }))
  const setup = combineHarnesses(setupShared, setupShared)

  await using first = await setup()
  expect(setupShared).toHaveBeenCalledTimes(1)
  expect(first.read()).toBe(true)

  await using second = await setup()
  expect(setupShared).toHaveBeenCalledTimes(2)
  expect(second.read()).toBe(true)
  expect(second.read).not.toBe(first.read)
})

it('shares dependencies across nested combinations and disposes each harness once in reverse order', async () => {
  const disposed: string[] = []
  const setupShared = vi.fn(async () => ({
    shared: {
      read: (): string => 'original',
      sibling: (): string => 'sibling',
    },
    async [Symbol.asyncDispose]() {
      disposed.push('shared')
    },
  }))
  const setupFirst = configureHarnesses(setupShared, (deps) => ({
    getFirstShared: () => deps.shared,
    async [Symbol.asyncDispose]() {
      disposed.push('first')
    },
  }))
  const setupSecond = configureHarnesses(setupShared, (deps) => ({
    getSecondShared: () => deps.shared,
    async [Symbol.asyncDispose]() {
      disposed.push('second')
    },
  }))
  const setupGroup = combineHarnesses(setupFirst, setupSecond)
  const setup = combineHarnesses(setupGroup, setupFirst)

  {
    await using harness = await setup({ shared: { read: () => 'override' } })

    expect(setupShared).toHaveBeenCalledTimes(1)
    expect(harness.getFirstShared()).toBe(harness.shared)
    expect(harness.getSecondShared()).toBe(harness.shared)
    expect(harness.shared.read()).toBe('override')
    expect(harness.shared.sibling()).toBe('sibling')
    expect(disposed).toEqual([])
  }

  expect(disposed).toEqual(['second', 'first', 'shared'])
})

it('works with empty harness list', async () => {
  const setup = combineHarnesses()
  await using harness = await setup()

  expect(harness).toEqual(expect.objectContaining({}))
})

describe('object dependencies', () => {
  it('wraps plain object methods with vi.fn and preserves identity', async () => {
    const setupStore = async () => ({
      store: {
        list: () => ['a'],
      },
    })

    const setup = combineHarnesses(setupStore)
    const value = await setup()
    await using harness = value

    expect(vi.isMockFunction(harness.store.list)).toBe(true)
    expect(harness.store.list()).toEqual(['a'])
    expect(harness.store.list).toHaveBeenCalledWith()
  })

  it('wraps class instance methods, including inherited ones, and preserves this, identity, and instanceof', async () => {
    class Counters {
      #count = 0
      increment(): this {
        this.#count++
        return this
      }
      value(): number {
        return this.#count
      }
    }

    const setupCounters = async () => ({
      counters: new Counters(),
    })

    const setup = combineHarnesses(setupCounters)
    await using harness = await setup()

    // oxlint-disable-next-line typescript/unbound-method -- only referenced for vi.isMockFunction, never called unbound
    expect(vi.isMockFunction(harness.counters.increment)).toBe(true)
    // oxlint-disable-next-line typescript/unbound-method -- only referenced for vi.isMockFunction, never called unbound
    expect(vi.isMockFunction(harness.counters.value)).toBe(true)

    const observed = harness.counters.increment()
    expect(harness.counters.value()).toBe(1)
    harness.counters.increment.mockRestore()
    expect(harness.counters.increment()).toBe(harness.counters)
    expect(harness.counters.value()).toBe(2)

    expect(observed).toBe(harness.counters)
    expect(harness.counters instanceof Counters).toBe(true)

    const counters: Counters = harness.counters
    expect(counters.value()).toBe(2)
  })

  it('does not wrap deny-listed values, accessors, or symbol keys', async () => {
    const symbolKey = Symbol('symbolic')
    const fetched: unknown[] = []
    const object = {
      created: new Date('2024-01-01T00:00:00.000Z'),
      items: ['a'],
      get size(): number {
        return fetched.length
      },
      record(item: unknown): void {
        fetched.push(item)
      },
      [symbolKey]: (): string => 'symbol',
    }
    const setupMixed = async () => ({ object })

    const setup = combineHarnesses(setupMixed)
    await using harness = await setup()

    expect(harness.object.created).toEqual(new Date('2024-01-01T00:00:00.000Z'))
    expect(harness.object.items).toEqual(['a'])
    expect(vi.isMockFunction(harness.object.size)).toBe(false)
    expect(harness.object.size).toBe(0)

    harness.object.record('x')
    expect(harness.object.size).toBe(1)

    expect(vi.isMockFunction(object[symbolKey])).toBe(false)
    // @ts-expect-error symbol keys are not wrapped, so no mock API exists
    void harness.object[symbolKey].mock
  })

  it('merges object dependency overrides in place, keeping sibling methods real on the same instance', async () => {
    const setupStore = async () => ({
      store: {
        list: () => ['original'],
        cancel: (id: string) => `cancelled ${id}`,
      },
    })
    const setupConsumer = async (deps: {
      store: { list: () => string[]; cancel: (id: string) => string }
    }) => ({
      consume: () => ({
        listed: deps.store.list(),
        cancelled: deps.store.cancel('r1'),
      }),
    })

    const setup = combineHarnesses(setupStore, setupConsumer)
    await using harness = await setup({
      store: { list: () => ['override'] },
    })

    expect(harness.consume().listed).toEqual(['override'])
    expect(harness.consume().cancelled).toBe('cancelled r1')
    expect(vi.isMockFunction(harness.store.cancel)).toBe(true)
    expect(Object.keys(harness.store)).toEqual(['list', 'cancel'])

    const direct = await setup()
    await using other = direct
    expect(other.consume().listed).toEqual(['original'])
  })

  it('keeps object overrides available before production and shares the overridden instance afterwards', async () => {
    class Store {
      #items = ['original']

      list(): string[] {
        return this.#items
      }

      consume() {
        return { listed: this.list(), original: this.#items }
      }
    }

    const store = new Store()
    const overrides = Object.freeze({
      store: Object.freeze({ list: () => ['override'] }),
    })
    const setupBefore = (deps: { store: Partial<Store> }) => {
      expect(deps.store.list?.()).toEqual(['override'])
      return {}
    }
    const setupStore = () => ({ store })
    const setupConsumer = (deps: { store: Store }) => {
      expect(deps.store).toBe(store)
      return { consume: () => deps.store.consume() }
    }

    const setup = combineHarnesses(setupBefore, setupStore, setupConsumer)
    await using harness = await setup(overrides)

    expect(harness.store).toBe(store)
    expect(harness.store).toBeInstanceOf(Store)
    expect(harness.consume()).toEqual({
      listed: ['override'],
      original: ['original'],
    })
    // oxlint-disable-next-line typescript/unbound-method -- only referenced for a mock assertion, never called unbound
    expect(harness.store.list).toHaveBeenCalledTimes(2)
    expect(vi.isMockFunction(overrides.store.list)).toBe(false)
    expect(Object.keys(overrides.store)).toEqual(['list'])
  })

  it('does not invoke accessors when wrapping object methods', async () => {
    let getterCalls = 0
    const setupState = async () => ({
      state: {
        get risky(): number {
          getterCalls++
          return 1
        },
        read: () => 2,
      },
    })

    const setup = combineHarnesses(setupState)
    await using harness = await setup()

    expect(getterCalls).toBe(0)
    expect(harness.state.read()).toBe(2)
  })

  it('tracks override calls made through references captured during setup', async () => {
    type Events = { subscribe: (fn: () => void) => void }
    let capturedSubscribe: Events['subscribe'] | undefined
    let overrideCalled = false

    const setupEvents = async (): Promise<{ events: Events }> => ({
      events: { subscribe: (_fn: () => void) => {} },
    })

    const setupCapture = async (deps: { events: Events }) => {
      capturedSubscribe = deps.events.subscribe
      return {}
    }

    const setupInner = combineHarnesses(setupEvents, setupCapture)
    const setup = combineHarnesses(setupInner, async () => ({}))

    await using harness = await setup({
      events: {
        subscribe: () => {
          overrideCalled = true
        },
      },
    })

    capturedSubscribe?.(() => {})

    expect(overrideCalled).toBe(true)
    expect(harness.events.subscribe).toHaveBeenCalledTimes(1)
  })
})

it('replaces non-mergeable result values with object overrides', async () => {
  const setupConfig = async (): Promise<{
    config: false | { enabled: boolean }
  }> => ({ config: false })

  const setup = combineHarnesses(setupConfig)
  await using harness = await setup({ config: { enabled: true } })

  expect(harness.config).toEqual({ enabled: true })
})

it('keeps null result values when no object override exists', async () => {
  const setupValue = async (): Promise<{ value: null }> => ({ value: null })

  const setup = combineHarnesses(setupValue)
  await using harness = await setup()

  expect(harness.value).toBe(null)
})
