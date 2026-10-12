import { expectTypeOf } from 'expect-type'
import type { MockInstance, MockedFunction } from 'vitest'
import { describe, expect, it } from 'vitest'
import { combineHarnesses } from './combineHarnesses'
import type {
  CombinedDeps,
  ExtractDeps,
  HarnessDeps,
  UserDepsMark,
} from './types'

type SetupA = (deps?: {
  alpha?: () => Promise<string>
  beta?: (x: number) => number
}) => Promise<{
  alpha: MockedFunction<() => Promise<string>>
  beta: MockedFunction<(x: number) => number>
  doA: () => void
}>

type SetupB = (deps?: { gamma?: () => boolean }) => Promise<{
  gamma: MockedFunction<() => boolean>
  doB: () => void
}>

type SetupWithDisposer = (deps?: { delta?: () => void }) => Promise<{
  delta: MockedFunction<() => void>
  [Symbol.asyncDispose]: () => Promise<void>
}>

describe('shared harness types', () => {
  it('HarnessDeps extracts the parameter type of a single harness', () => {
    type Result = HarnessDeps<SetupA>
    expectTypeOf<Result>().toEqualTypeOf<{
      alpha?: () => Promise<string>
      beta?: (x: number) => number
    }>()
  })

  it('CombinedDeps merges parameter types of multiple harnesses', () => {
    type Result = CombinedDeps<[SetupA, SetupB]>
    expectTypeOf<Result>().toHaveProperty('alpha')
    expectTypeOf<Result>().toHaveProperty('beta')
    expectTypeOf<Result>().toHaveProperty('gamma')
  })

  it('ExtractDeps with harnesses extracts function-typed keys from CombinedDeps', () => {
    type Source = { harnesses: [SetupA, SetupB] }
    type Result = ExtractDeps<Source>
    expectTypeOf<Result>().toHaveProperty('alpha')
    expectTypeOf<Result>().toHaveProperty('beta')
    expectTypeOf<Result>().toHaveProperty('gamma')
  })

  it('ExtractDeps excludes Symbol.asyncDispose from harness deps', () => {
    type Source = { harnesses: [SetupWithDisposer] }
    type Result = ExtractDeps<Source>
    type HasDelta = 'delta' extends keyof Result ? true : false
    expectTypeOf<HasDelta>().toEqualTypeOf<true>()
    type HasDispose = typeof Symbol.asyncDispose extends keyof Result
      ? true
      : false
    expectTypeOf<HasDispose>().toEqualTypeOf<false>()
  })

  it('ExtractDeps with defaultDeps passes through directly', () => {
    type Deps = { foo: () => string; bar: (x: number) => number }
    type Source = { defaultDeps: Deps }
    type Result = ExtractDeps<Source>
    expectTypeOf<Result>().toEqualTypeOf<Deps>()
  })

  it('ExtractDeps combines defaultDeps with harness deps', () => {
    type Deps = { foo: () => string }
    type Source = { defaultDeps: Deps; harnesses: [SetupA] }
    type Result = ExtractDeps<Source>
    expectTypeOf<Result>().toHaveProperty('foo')
    expectTypeOf<Result>().toHaveProperty('alpha')
    expectTypeOf<Result>().toHaveProperty('beta')
  })

  it('ExtractDeps extracts function keys from multiple harnesses', () => {
    type Source = { harnesses: [SetupA, SetupB] }
    type Result = ExtractDeps<Source>
    expectTypeOf<Result>().toHaveProperty('alpha')
    expectTypeOf<Result>().toHaveProperty('beta')
    expectTypeOf<Result>().toHaveProperty('gamma')
  })
})

describe('object dependency typing', () => {
  const createTestStore = () => {
    const cancelled: string[] = []
    return {
      list: (): string[] => [],
      cancel: (id: string) => {
        cancelled.push(id)
      },
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    }
  }

  const setupStore = async () => ({ store: createTestStore() })

  it('types object dependency methods as Mock', async () => {
    const setup = combineHarnesses(setupStore)
    await using harness = await setup()

    expectTypeOf(harness.store.list).toEqualTypeOf<
      (() => string[]) & MockInstance<() => string[]>
    >()
    expectTypeOf(harness.store.cancel).toEqualTypeOf<
      ((id: string) => void) & MockInstance<(id: string) => void>
    >()
    expectTypeOf(harness.store.createdAt).toEqualTypeOf<Date>()
  })

  it('preserves generic signatures of object dependency methods', async () => {
    const setupGeneric = async () => ({
      store: {
        runWithLoader: async <T>(args: {
          description: string
          run: (runArgs: { signal: string }) => Promise<T>
        }): Promise<T> => args.run({ signal: 'original' }),
      },
    })
    const setup = combineHarnesses(setupGeneric)
    await using harness = await setup()

    harness.store.runWithLoader.mockImplementation(async (args) =>
      args.run({ signal: 'override' })
    )
    const result = await harness.store.runWithLoader({
      description: 'test',
      run: async () => 123,
    })

    expectTypeOf(result).toEqualTypeOf<number>()
    expect(result).toBe(123)
  })

  it('accepts deep-partial object dependency overrides and rejects unknown nested keys', async () => {
    const setup = combineHarnesses(setupStore)

    await using harness = await setup({
      store: {
        list: () => ['override'],
      },
    })
    expect(harness.store.list()).toEqual(['override'])

    await using rejected = await setup({
      store: {
        // @ts-expect-error unknown nested key must be rejected
        missing: () => {},
      },
    })
    expect(Object.keys(rejected.store)).toContain('list')
  })

  it('types harness.store.list.mock', async () => {
    const setup = combineHarnesses(setupStore)
    await using harness = await setup()

    expect(harness.store.list.mock.calls).toEqual([])
  })
})

describe('UserDepsMark', () => {
  it('taints deps while preserving the original deps shape', () => {
    type Deps = { alpha?: () => Promise<string> }

    expectTypeOf<UserDepsMark<Deps>>().toExtend<Deps>()
    expectTypeOf<Deps>().not.toExtend<UserDepsMark<Deps>>()
  })

  it('does not survive object spread', () => {
    type Deps = { alpha?: () => Promise<string> }

    function assertSpreadLosesUserDepsMark(markedUserDeps: UserDepsMark<Deps>) {
      // @ts-expect-error Object spread must not preserve the UserDepsMark taint.
      const userDeps: UserDepsMark<Deps & { somethingElse: () => string }> = {
        ...markedUserDeps,
        somethingElse: () => 'extra',
      }

      expectTypeOf(userDeps).not.toBeAny()
    }

    expectTypeOf(assertSpreadLosesUserDepsMark).not.toBeAny()
  })
})
