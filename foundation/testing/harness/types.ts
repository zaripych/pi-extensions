import type { Mock, MockedFunction } from 'vitest';

type SimplifyFunction<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R
  : T;

export type SimplifyDeps<D> = {
  [K in keyof D]: SimplifyFunction<D[K]>;
};

export type AnyFunction = (...args: never[]) => unknown;

export type DepsRecord = Record<string, AnyFunction>;

export type MockedDeps<D> = {
  [K in keyof D]: D[K] extends AnyFunction ? MockedFunction<D[K]> : never;
};

type EmptyObject = Record<never, never>;

export type AnyHarness = (deps: never) => unknown;

export type HarnessResult<H extends AnyHarness> = Awaited<ReturnType<H>>;

export type OmitDispose<T> = Omit<T, typeof Symbol.asyncDispose>;

export type MockifyFunctions<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K];
};

export type CombinedResult<Harnesses extends AnyHarness[]> = MockifyFunctions<
  Harnesses extends [
    infer First extends AnyHarness,
    ...infer Rest extends AnyHarness[],
  ]
    ? OmitDispose<HarnessResult<First>> & CombinedResult<Rest>
    : EmptyObject
>;

export type HarnessDeps<H extends AnyHarness> =
  Parameters<H>[0] extends undefined
    ? EmptyObject
    : Exclude<Parameters<H>[0], undefined>;

export type CombinedDeps<Harnesses extends AnyHarness[]> = SimplifyDeps<
  Harnesses extends [
    infer First extends AnyHarness,
    ...infer Rest extends AnyHarness[],
  ]
    ? HarnessDeps<First> & CombinedDeps<Rest>
    : EmptyObject
>;

export type AccumulatedResult<Harnesses extends AnyHarness[]> =
  Harnesses extends [
    infer First extends AnyHarness,
    ...infer Rest extends AnyHarness[],
  ]
    ? Omit<Awaited<ReturnType<First>>, typeof Symbol.asyncDispose> &
        AccumulatedResult<Rest>
    : EmptyObject;

export type EnforceOverlap<D, Expected> = {
  [K in keyof D]: K extends keyof Expected
    ? Expected[K] extends D[K]
      ? D[K]
      : Expected[K]
    : D[K];
};

export type HarnessSetupInput<D, Middle extends AnyHarness[]> = UserDepsMark<
  Omit<D, keyof AccumulatedResult<Middle>> & AccumulatedResult<Middle>
>;

export type HarnessSetupResult<
  D,
  Middle extends AnyHarness[],
  R,
> = MockifyFunctions<
  Omit<D, keyof AccumulatedResult<Middle>> & AccumulatedResult<Middle>
> &
  R &
  AsyncDisposable;

declare class UserDepsMarkBrand {
  private readonly 'Not allowed. See foundation/testing/docs/testing-harness.md': true;
}

export type UserDepsMark<T> = T & UserDepsMarkBrand;

export type StripUserDepsMark<T> = Omit<T, keyof UserDepsMarkBrand>;

type FunctionDeps<T> = {
  [K in keyof T as NonNullable<T[K]> extends AnyFunction ? K : never]: Extract<
    NonNullable<T[K]>,
    AnyFunction
  >;
};

export type ExtractHarnesses<T> = T extends {
  harnesses: infer H extends AnyHarness[];
}
  ? H
  : [];

type ExtractHarnessDeps<T> = T extends {
  harnesses: infer H extends AnyHarness[];
}
  ? Required<CombinedDeps<H>> extends infer CD
    ? FunctionDeps<CD>
    : EmptyObject
  : EmptyObject;

export type ExtractDeps<T> = T extends {
  defaultDeps: infer D extends DepsRecord;
  harnesses: AnyHarness[];
}
  ? D & ExtractHarnessDeps<T>
  : T extends { defaultDeps: infer D extends DepsRecord }
    ? D
    : ExtractHarnessDeps<T>;

export type Configurators<D> = {
  [K in keyof D]?: D[K] extends (...args: infer A) => infer R
    ? MockedFunction<D[K]> | ((...args: A) => Awaited<R> | R)
    : never;
};

export type UserDeps<D> = UserDepsMark<Partial<SimplifyDeps<D>>>;
