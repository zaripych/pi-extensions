import { AsyncDisposableStack } from './asyncDisposableStack'
import { isCallable, wrapOnce } from './helpers'
import type {
  AnyHarness,
  CombinedDeps,
  CombinedResult,
  HarnessResult,
  OmitDispose,
  SimplifyDeps,
} from './types'

function wrapFunctionProperties<T extends Record<string, unknown>>(
  values: T
): T {
  const wrapped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    wrapped[key] = isCallable(value) ? wrapOnce(value) : value
  }

  // oxlint-disable typescript/consistent-type-assertions -- dynamically constructed return cannot be proven to match T
  return wrapped as T
  // oxlint-enable typescript/consistent-type-assertions
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
 * Harnesses run in order. Each receives `{ ...accumulatedResults, ...userOverrides }`.
 * User overrides always take priority. Disposal runs in reverse order.
 *
 * Keys must be unique across harnesses — no two harnesses should return the
 * same property name.
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
  type Overrides = Partial<SimplifyDeps<CombinedDeps<Harnesses> & RawResult>>
  type Result = CombinedResult<Harnesses> & AsyncDisposable

  return async (overrides: Overrides = {}): Promise<Result> => {
    const stack = new AsyncDisposableStack()

    const accumulated: Record<string, unknown> = {}
    const wrappedOverrides = wrapFunctionProperties(overrides)

    for (const harness of harnesses) {
      const input = { ...accumulated, ...wrappedOverrides }
      // oxlint-disable typescript/consistent-type-assertions -- accumulated input and harness return are dynamically constructed
      const result = (await harness(input as never)) as Record<string, unknown>
      // oxlint-enable typescript/consistent-type-assertions

      if (isAsyncDisposable(result)) {
        const dispose = result[Symbol.asyncDispose].bind(result)
        stack.defer(dispose)
      }

      const wrappedResult = wrapFunctionProperties(result)

      for (const key of Object.keys(wrappedResult)) {
        accumulated[key] = wrappedResult[key]
      }
    }

    const merged: Record<string, unknown> = {
      ...accumulated,
      ...wrappedOverrides,
    }

    // oxlint-disable typescript/consistent-type-assertions -- merged result is dynamically constructed from accumulated harness outputs
    return {
      ...merged,
      async [Symbol.asyncDispose]() {
        await stack[Symbol.asyncDispose]()
      },
    } as unknown as Result
    // oxlint-enable typescript/consistent-type-assertions
  }
}
