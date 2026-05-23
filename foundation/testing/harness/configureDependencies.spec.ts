import { expectTypeOf } from 'expect-type'
import type { MockedFunction } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { configureDependencies } from './configureDependencies'
import { configureHarnesses } from './configureHarnesses'

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

const setupA: SetupA = async (deps) => ({
  alpha: vi.fn(deps?.alpha ?? (async () => 'default')),
  beta: vi.fn(deps?.beta ?? ((x: number) => x)),
  doA: vi.fn(),
})

const setupB: SetupB = async (deps) => ({
  gamma: vi.fn(deps?.gamma ?? (() => true)),
  doB: vi.fn(),
})

describe('configureDependencies runtime + type inference', () => {
  it('returns configured dependencies synchronously', () => {
    const defaultDeps = { alpha: () => 'default' }

    const result = configureDependencies(
      { inferTypesFrom: { defaultDeps } },
      {
        alpha: () => 'configured',
      }
    )

    expectTypeOf(result.alpha).toEqualTypeOf<MockedFunction<() => string>>()
    expect(result.alpha()).toBe('configured')
  })

  it('rejects constructed user deps in defaultDeps mode', () => {
    const defaultDeps = { alpha: async () => 'default' }

    function assertConstructedUserDepsRejected(
      userDeps?: Partial<typeof defaultDeps>
    ) {
      void configureDependencies(
        {
          inferTypesFrom: { defaultDeps },
          // @ts-expect-error User deps must come from harness input; defaults belong in configurators.
          userDeps: {
            ...userDeps,
            alpha: vi.fn(),
          },
        },
        {
          alpha: () => 'configured',
        }
      )
    }

    expectTypeOf(assertConstructedUserDepsRejected).not.toBeAny()
  })

  it('rejects unmarked user deps', () => {
    function assertPlainUserDepsRejected() {
      void configureDependencies(
        {
          inferTypesFrom: {
            harnesses: [setupA],
          },
          // @ts-expect-error User deps must come from configureHarnesses input.
          userDeps: { alpha: async () => 'plain' },
        },
        {}
      )
    }

    expectTypeOf(assertPlainUserDepsRejected).not.toBeAny()
  })

  it('accepts marked user deps from configureHarnesses and uses them as overrides', async () => {
    const alpha = async () => 'override'
    const setup = configureHarnesses(setupA, (userDeps) => {
      const result = configureDependencies(
        {
          inferTypesFrom: {
            harnesses: [setupA],
          },
          userDeps,
        },
        {
          alpha: () => 'configured',
        }
      )

      return { result }
    })

    await using harness = await setup({ alpha })

    expect(vi.isMockFunction(harness.result.alpha)).toBe(true)
    expect(await harness.result.alpha()).toBe('override')
  })

  it('infers dependency types from marked user deps without inferTypesFrom', async () => {
    const defaultDeps = { alpha: async () => 'default' }

    const setup = configureHarnesses(
      { inferTypesFrom: { defaultDeps } },
      (userDeps) => {
        const result = configureDependencies(
          { userDeps },
          {
            alpha: () => 'configured',
          }
        )

        return { result }
      }
    )

    await using harness = await setup()

    expect(vi.isMockFunction(harness.result.alpha)).toBe(true)
    expect(await harness.result.alpha()).toBe('configured')
  })

  it('infers configurator fn type from harnesses', async () => {
    const result = configureDependencies(
      {
        inferTypesFrom: {
          harnesses: [setupA, setupB],
        },
      },
      {
        alpha: () => 'hello',
        gamma: () => false,
      }
    )

    expectTypeOf(result.alpha).not.toBeAny()
    expectTypeOf(result.gamma).not.toBeAny()
    expect(vi.isMockFunction(result.alpha)).toBe(true)
    expect(vi.isMockFunction(result.gamma)).toBe(true)
    expect(await result.alpha()).toBe('hello')
    expect(result.gamma()).toBe(false)
  })
})
