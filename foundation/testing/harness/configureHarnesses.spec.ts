import { expectTypeOf } from 'expect-type';
import type { MockedFunction } from 'vitest';
import { expect, it, vi } from 'vitest';
import { configureDependencies } from './configureDependencies';
import { configureHarnesses } from './configureHarnesses';
import type { UserDepsMark } from './types';

type SetupA = (deps?: {
  alpha?: () => Promise<string>;
  beta?: (x: number) => number;
}) => Promise<{
  alpha: MockedFunction<() => Promise<string>>;
  beta: MockedFunction<(x: number) => number>;
  doA: () => void;
}>;

const setupA: SetupA = async (deps) => ({
  alpha: vi.fn(deps?.alpha ?? (async () => 'default')),
  beta: vi.fn(deps?.beta ?? ((x: number) => x)),
  doA: vi.fn(),
});

it('works with a single configure function and no inferTypesFrom params', async () => {
  const setup = configureHarnesses(async (deps) => {
    expectTypeOf(deps).toExtend<UserDepsMark<Record<never, never>>>();
    return { x: 42 };
  });

  await using harness = await setup();

  expectTypeOf(harness).toExtend<{ x: number } & AsyncDisposable>();
  expect(harness).toEqual(expect.objectContaining({ x: 42 }));
});

it('accepts a sync configure function', async () => {
  const setup = configureHarnesses((deps) => {
    expectTypeOf(deps).toExtend<UserDepsMark<Record<never, never>>>();
    return { x: 42 };
  });

  await using harness = await setup();

  expectTypeOf(harness).toExtend<{ x: number } & AsyncDisposable>();
  expect(harness).toEqual(expect.objectContaining({ x: 42 }));
});

it('automatically types deps of the last function from preceding harnesses without inferTypesFrom params', async () => {
  const setupInitial = async () => ({ a: 1, b: 'hello' });

  const setup = configureHarnesses(setupInitial, async (deps) => {
    expectTypeOf(deps).toExtend<UserDepsMark<{ a: number; b: string }>>();
    return { c: deps.a + 1 };
  });

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    { a: number; b: string; c: number } & AsyncDisposable
  >();
  expect(harness).toEqual(expect.objectContaining({ a: 1, b: 'hello', c: 2 }));
});

it('accepts a sync preceding harness', async () => {
  const setupInitial = () => ({ a: 1, b: 'hello' });

  const setup = configureHarnesses(setupInitial, (deps) => {
    expectTypeOf(deps).toExtend<UserDepsMark<{ a: number; b: string }>>();
    return { c: deps.a + 1 };
  });

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    { a: number; b: string; c: number } & AsyncDisposable
  >();
  expect(harness).toEqual(expect.objectContaining({ a: 1, b: 'hello', c: 2 }));
});

it('accumulates results from multiple preceding harnesses without inferTypesFrom params', async () => {
  const setupInitial = async () => ({ a: 10 });
  const setupMiddle = async () => ({ b: 'world' });

  const setup = configureHarnesses(setupInitial, setupMiddle, async (deps) => {
    expectTypeOf(deps).toExtend<UserDepsMark<{ a: number } & { b: string }>>();
    return { c: `${deps.b}-${deps.a}` };
  });

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    { a: number; b: string; c: string } & AsyncDisposable
  >();
  expect(harness).toEqual(
    expect.objectContaining({ a: 10, b: 'world', c: 'world-10' }),
  );
});

it('types the next setup function from defaultDeps only', async () => {
  const defaultDeps = {
    gamma: () => true,
  };

  const setup = configureHarnesses(
    {
      inferTypesFrom: { defaultDeps },
    },
    (userDeps) => {
      expectTypeOf(userDeps).toExtend<
        UserDepsMark<{
          gamma: () => boolean;
        }>
      >();

      const result = configureDependencies(
        { userDeps },
        {
          gamma: () => false,
        },
      );

      return { result };
    },
  );

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    {
      result: {
        gamma: MockedFunction<() => boolean>;
      };
    } & AsyncDisposable
  >();
  expect(harness.result.gamma()).toBe(false);
});

it('types the next setup function from harnesses only', async () => {
  const setup = configureHarnesses(
    {
      inferTypesFrom: { harnesses: [setupA] },
    },
    (userDeps) => {
      expectTypeOf(userDeps).toExtend<
        UserDepsMark<{
          alpha: () => Promise<string>;
          beta: (x: number) => number;
        }>
      >();

      const result = configureDependencies(
        { userDeps },
        {
          alpha: () => 'configured',
          beta: (x) => x + 1,
        },
      );

      return { result };
    },
  );

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    {
      result: {
        alpha: MockedFunction<() => Promise<string>>;
        beta: MockedFunction<(x: number) => number>;
      };
    } & AsyncDisposable
  >();
  expect(harness).toEqual(
    expect.not.objectContaining({ doA: expect.any(Function) }),
  );
  expect(await harness.result.alpha()).toBe('configured');
  expect(harness.result.beta(1)).toBe(2);
});

it('types the next setup function from defaultDeps and harnesses', async () => {
  const defaultDeps = {
    gamma: () => true,
  };

  const setup = configureHarnesses(
    {
      inferTypesFrom: { defaultDeps, harnesses: [setupA] },
    },
    (userDeps) => {
      expectTypeOf(userDeps).toExtend<
        UserDepsMark<{
          alpha: () => Promise<string>;
          beta: (x: number) => number;
          gamma: () => boolean;
        }>
      >();

      const result = configureDependencies(
        { userDeps },
        {
          gamma: () => false,
        },
      );

      return { result };
    },
  );

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    {
      result: {
        gamma: MockedFunction<() => boolean>;
      };
    } & AsyncDisposable
  >();
  expect(harness).toEqual(
    expect.not.objectContaining({ doA: expect.any(Function) }),
  );
  expect(harness.result.gamma()).toBe(false);
});

it('uses inferTypesFrom.harnesses for types and explicit harness parameters for runtime', async () => {
  const defaultDeps = {
    gamma: () => true,
  };

  const setup = configureHarnesses(
    {
      inferTypesFrom: { defaultDeps, harnesses: [setupA] },
    },
    (userDeps) => {
      const result = configureDependencies(
        { userDeps },
        {
          alpha: () => 'configured before setupA',
        },
      );

      return { ...result };
    },
    setupA,
    (userDeps) => {
      const result = configureDependencies(
        { userDeps },
        {
          gamma: () => false,
        },
      );

      return { result };
    },
  );

  await using harness = await setup();

  expectTypeOf(harness).toExtend<
    {
      alpha: MockedFunction<() => Promise<string>>;
      beta: MockedFunction<(x: number) => number>;
      doA: () => void;
      result: {
        gamma: MockedFunction<() => boolean>;
      };
    } & AsyncDisposable
  >();
  expect(await harness.alpha()).toBe('configured before setupA');
  expect(harness.result.gamma()).toBe(false);
});
