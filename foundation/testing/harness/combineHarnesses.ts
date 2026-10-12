import { AsyncDisposableStack } from './asyncDisposableStack'
import {
  isCallable,
  isWrappableObject,
  wrapObjectMethods,
  wrapOnce,
} from './helpers'
import type {
  AnyHarness,
  CombinedDeps,
  CombinedResult,
  HarnessOverrides,
  HarnessResult,
  OmitDispose,
  SimplifyDeps,
} from './types'

const combinedHarnesses = Symbol('combinedHarnesses')

function flattenHarnesses(
  harnesses: readonly (AnyHarness & {
    readonly [combinedHarnesses]?: ReadonlySet<AnyHarness>
  })[]
): ReadonlySet<AnyHarness> {
  const flattenedHarnesses = new Set<AnyHarness>()
  for (const harness of harnesses) {
    const nestedHarnesses = harness[combinedHarnesses]
    if (nestedHarnesses === undefined) {
      flattenedHarnesses.add(harness)
    } else {
      for (const nestedHarness of nestedHarnesses) {
        flattenedHarnesses.add(nestedHarness)
      }
    }
  }
  return flattenedHarnesses
}

function wrapOverrideValues(overrides: Record<string, unknown>) {
  const objectOverrides: Record<string, Record<string, unknown>> = {}
  const otherOverrides: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(overrides)) {
    if (isWrappableObject(value)) {
      const copy: Record<string, unknown> = {}
      for (const [name, member] of Object.entries(value)) {
        copy[name] = isCallable(member) ? wrapOnce(member) : member
      }
      objectOverrides[key] = copy
    } else {
      otherOverrides[key] = isCallable(value) ? wrapOnce(value) : value
    }
  }

  return { objectOverrides, otherOverrides }
}

function wrapResultProperties({
  values,
  objectOverrides,
}: {
  values: Record<string, unknown>
  objectOverrides: Readonly<Record<string, Record<string, unknown>>>
}): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    if (isCallable(value)) {
      wrapped[key] = wrapOnce(value)
    } else if (isWrappableObject(value)) {
      wrapObjectMethods(value)
      const override = objectOverrides[key]
      if (override !== undefined && value !== override) {
        Object.assign(value, override)
      }
      wrapped[key] = value
    } else if (objectOverrides[key] !== undefined) {
      wrapped[key] = objectOverrides[key]
    } else {
      wrapped[key] = value
    }
  }

  return wrapped
}

function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  if (value === null || typeof value !== 'object') {
    return false
  }

  return (
    Symbol.asyncDispose in value &&
    typeof value[Symbol.asyncDispose] === 'function'
  )
}

/**
 * Combines multiple harness functions into a single setup function.
 *
 * Harnesses run in order, once per function identity per setup call, including
 * nested combinations. Object overrides merge into produced instances;
 * other overrides always take priority. Disposal runs in reverse order.
 *
 * Keys must be unique across distinct harnesses.
 */
export function combineHarnesses<const Harnesses extends AnyHarness[]>(
  ...harnesses: Harnesses
) {
  type RawResult = Harnesses extends [
    infer First extends AnyHarness,
    ...infer Rest extends AnyHarness[],
  ]
    ? OmitDispose<HarnessResult<First>> & CombinedResult<Rest>
    : Record<never, never>
  type Overrides = HarnessOverrides<
    SimplifyDeps<CombinedDeps<Harnesses> & RawResult>
  >
  type Result = CombinedResult<Harnesses> & AsyncDisposable

  const flattenedHarnesses = flattenHarnesses(harnesses)

  const setup = async (overrides: Overrides = {}): Promise<Result> => {
    const stack = new AsyncDisposableStack()

    const accumulated: Record<string, unknown> = {}
    const { objectOverrides, otherOverrides } = wrapOverrideValues(overrides)

    for (const harness of flattenedHarnesses) {
      const input = { ...objectOverrides, ...accumulated, ...otherOverrides }
      // oxlint-disable typescript/consistent-type-assertions -- accumulated input and harness return are dynamically constructed
      const result = (await harness(input as never)) as Record<string, unknown>
      // oxlint-enable typescript/consistent-type-assertions

      if (isAsyncDisposable(result)) {
        const dispose = result[Symbol.asyncDispose].bind(result)
        stack.defer(dispose)
      }

      Object.assign(
        accumulated,
        wrapResultProperties({ values: result, objectOverrides })
      )
    }

    // oxlint-disable typescript/consistent-type-assertions -- merged result is dynamically constructed from accumulated harness outputs
    return {
      ...objectOverrides,
      ...accumulated,
      ...otherOverrides,
      async [Symbol.asyncDispose]() {
        await stack[Symbol.asyncDispose]()
      },
    } as unknown as Result
    // oxlint-enable typescript/consistent-type-assertions
  }

  return Object.assign(setup, { [combinedHarnesses]: flattenedHarnesses })
}
