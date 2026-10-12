import { combineHarnesses } from './combineHarnesses'
import type {
  AccumulatedResult,
  AnyHarness,
  ExtractDeps,
  HarnessOverrides,
  MockifyFunctions,
  MockifyObjectDependencies,
  UserDepsMark,
} from './types'

type HarnessTypeSource = {
  defaultDeps?: Record<string, (...args: never[]) => unknown>
  harnesses?: AnyHarness[]
}

type SetupInput<Source> = UserDepsMark<ExtractDeps<Source>>

type LastSetupInput<Source, D, Middle extends AnyHarness[]> = UserDepsMark<
  Omit<ExtractDeps<Source> & D, keyof AccumulatedResult<Middle>> &
    AccumulatedResult<Middle>
>

type MaybePromise<T> = T | Promise<T>

type ResultAfterDefaults<
  Source,
  D,
  Middle extends AnyHarness[],
  R,
> = MockifyFunctions<
  Omit<ExtractDeps<Source> & D, keyof AccumulatedResult<Middle>> &
    AccumulatedResult<Middle>
> &
  MockifyObjectDependencies<R> &
  AsyncDisposable

function hasInferTypesFrom(
  value: unknown
): value is { inferTypesFrom: HarnessTypeSource } {
  return (
    typeof value === 'object' && value !== null && 'inferTypesFrom' in value
  )
}

export function configureHarnesses<R>(
  last: (deps: UserDepsMark<Record<never, never>>) => MaybePromise<R>
): (
  overrides?: HarnessOverrides<R>
) => Promise<MockifyObjectDependencies<R> & AsyncDisposable>

export function configureHarnesses<Init extends AnyHarness, R>(
  init: Init,
  last: (deps: UserDepsMark<AccumulatedResult<[Init]>>) => MaybePromise<R>
): (
  overrides?: HarnessOverrides<AccumulatedResult<[Init]> & R>
) => Promise<
  MockifyFunctions<AccumulatedResult<[Init]>> &
    MockifyObjectDependencies<R> &
    AsyncDisposable
>

export function configureHarnesses<
  D,
  const Middle extends [AnyHarness, ...AnyHarness[]],
  R,
>(
  defaults: (...args: never[]) => MaybePromise<D>,
  ...args: [
    ...Middle,
    (
      deps: UserDepsMark<
        Omit<D, keyof AccumulatedResult<Middle>> & AccumulatedResult<Middle>
      >
    ) => MaybePromise<R>,
  ]
): (
  overrides?: HarnessOverrides<D & AccumulatedResult<Middle> & R>
) => Promise<
  MockifyFunctions<
    Omit<D, keyof AccumulatedResult<Middle>> & AccumulatedResult<Middle>
  > &
    MockifyObjectDependencies<R> &
    AsyncDisposable
>

export function configureHarnesses<const Source extends HarnessTypeSource, R>(
  params: { inferTypesFrom: Source },
  last: (deps: SetupInput<Source>) => MaybePromise<R>
): (
  overrides?: HarnessOverrides<ExtractDeps<Source> & R>
) => Promise<MockifyObjectDependencies<R> & AsyncDisposable>

export function configureHarnesses<
  const Source extends HarnessTypeSource,
  D,
  const Middle extends AnyHarness[],
  R,
>(
  params: { inferTypesFrom: Source },
  defaults: (deps: SetupInput<Source>) => MaybePromise<D>,
  ...args: [
    ...Middle,
    (deps: LastSetupInput<Source, D, Middle>) => MaybePromise<R>,
  ]
): (
  overrides?: HarnessOverrides<
    ExtractDeps<Source> & D & AccumulatedResult<Middle> & R
  >
) => Promise<ResultAfterDefaults<Source, D, Middle, R>>

export function configureHarnesses(
  ...args: [{ inferTypesFrom: HarnessTypeSource } | AnyHarness, ...AnyHarness[]]
) {
  const [arg0, ...rest] = args
  const setups = hasInferTypesFrom(arg0) ? rest : [arg0, ...rest]
  return combineHarnesses(...setups)
}
