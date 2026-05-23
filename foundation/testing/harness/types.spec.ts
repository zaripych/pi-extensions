import { expectTypeOf } from 'expect-type'
import type { MockedFunction } from 'vitest'
import { describe, it } from 'vitest'
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
