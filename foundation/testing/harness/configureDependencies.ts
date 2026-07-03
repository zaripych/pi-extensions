import { vi } from 'vitest'
import { isCallable, wrapOnce } from './helpers'
import type {
  AnyFunction,
  AnyHarness,
  Configurators,
  DepsRecord,
  ExtractDeps,
  MockedDeps,
  UserDeps,
  UserDepsMark,
} from './types'

type DependencyTypeSource =
  | { defaultDeps: DepsRecord }
  | { harnesses: AnyHarness[] }

type ConfigureDependenciesParams<Source extends DependencyTypeSource> = {
  inferTypesFrom: Source
  userDeps?: UserDeps<ExtractDeps<Source>>
}

type ConfigureDependenciesFromUserDepsParams<D> = {
  userDeps?: UserDepsMark<D>
}

type FunctionDeps<D> = {
  [K in keyof D as NonNullable<D[K]> extends AnyFunction ? K : never]: Extract<
    NonNullable<D[K]>,
    AnyFunction
  >
}

type DepsFromParams<Params> = Params extends {
  inferTypesFrom: infer Source extends DependencyTypeSource
}
  ? ExtractDeps<Source>
  : Params extends { userDeps?: UserDepsMark<infer D> }
    ? FunctionDeps<D>
    : never

export function configureDependencies<
  const Params extends
    | ConfigureDependenciesParams<DependencyTypeSource>
    | ConfigureDependenciesFromUserDepsParams<unknown>,
>(
  params: Params,
  configurators: Configurators<DepsFromParams<Params>>
): MockedDeps<DepsFromParams<Params>> {
  // oxlint-disable typescript/consistent-type-assertions -- stripping UserDepsMarkBrand declared in types.ts
  const userDeps = params.userDeps as
    | Partial<Record<string, unknown>>
    | undefined
  // oxlint-enable typescript/consistent-type-assertions
  const userFunctionKeys = Object.keys(userDeps ?? {}).filter(
    (key) => typeof userDeps?.[key] === 'function'
  )
  const keys: string[] = [
    ...new Set([...Object.keys(configurators), ...userFunctionKeys]),
  ]

  const result: Record<string, unknown> = {}

  for (const key of keys) {
    if (userDeps && key in userDeps) {
      const value = userDeps[key]
      result[key] = isCallable(value) ? wrapOnce(value) : value
    } else {
      const configurator =
        // oxlint-disable typescript/consistent-type-assertions -- dynamic key access into generic Configurators type
        (configurators as Record<string, AnyFunction | undefined>)[key]
      // oxlint-enable typescript/consistent-type-assertions
      result[key] = configurator ? wrapOnce(configurator) : vi.fn<AnyFunction>()
    }
  }

  // oxlint-disable typescript/consistent-type-assertions -- dynamically constructed return cannot be proven to match generic MockedDeps
  return result as MockedDeps<DepsFromParams<Params>>
  // oxlint-enable typescript/consistent-type-assertions
}
