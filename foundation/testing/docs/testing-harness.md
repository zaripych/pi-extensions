# Test Harnesses

Test harnesses are composable setup functions that create mock dependencies for testing. They build on the [dependency injection](dependency-injection.md) pattern — every module exposes its deps via `defaultDeps`, and harnesses replace those deps with test doubles.

For how to write tests using these harnesses, read [writing-tests.md](writing-tests.md).

## Principles

- **Harnesses are co-located** with the module they set up: `notifyUser.ts` → `notifyUser.harness.ts`.
- **Harnesses are not storage for test data.** Test data belongs in the test file, not shared through harnesses. Harness defaults must produce structurally valid results (see [Defaults must produce valid results](#defaults-must-produce-valid-results)), but should use randomised placeholder values (e.g., via `faker`) to discourage tests from asserting against default data. Tests that care about specific values must override them; tests that don't care just let the harness work.
- **Dependency keys are never renamed.** If `createDbClient` is the dep name in production code, the harness returns it as `createDbClient`. This keeps names searchable across the codebase.
- **Every function returned by `combineHarnesses` is automatically wrapped with `vi.fn`** (via `wrapOnce` — already-mocked functions are not re-wrapped). This means tests can call `.mockImplementation()`, `.toHaveBeenCalledWith()`, etc. on any harness-provided function without extra setup.
- **Methods on object dependencies are wrapped in place**, preserving identity and `this` — see [Object dependencies](#object-dependencies).
- **Tests never import dependencies directly.** All dependencies — database clients, external services, etc. — must flow through harnesses. Tests receive them from the harness object, never from direct imports. If a harness for a dependency does not exist, create one before writing the test.

## Checklist: creating a harness

1. **Look up existing harnesses** for the dependencies used by the module.
2. **Compose existing harnesses** — don't re-mock what another harness already provides.
3. **Create harnesses for imported dependencies that don't have one yet** — do this before writing your harness or tests. Dependencies defined inline in `defaultDeps` (e.g. direct SDK calls) are mocked in the harness itself.
4. **Search for other places that manually mock the same dependency** and replace them with the new harness. This promotes composability and reduces duplication.

## Dependency flow

All dependencies flow through harnesses. The test file sets up a combined harness and receives both the functions under test and the shared dependencies from it. Functions under test receive the same dependency instances because the harness binds them via `withDeps`. The test uses those same instances to seed data, make assertions, or inspect calls.

```
┌─────────────────────────────────────────────────────────────┐
│                        Test file                            │
│                                                             │
│   const setup = combineHarnesses(setupModule);              │
│   await using harness = await setup();                      │
│                                                             │
│   ┌───────────────────────────────────────────────────────┐ │
│   │                    harness                            │ │
│   │                                                       │ │
│   │   databaseClient ─────────┐                           │ │
│   │   send ───────────────┐   │                           │ │
│   │   ...                 │   │                           │ │
│   │                       │   │                           │ │
│   │   functionUnderTest ──┼───┼── bound via withDeps      │ │
│   │                       │   │                           │ │
│   └───────────────────────┼───┼───────────────────────────┘ │
│                           │   │                             │
│   // Test uses same deps  │   │  // Function under test     │
│   // to seed & assert     │   │  // receives same deps      │
│   const db = harness      │   │  // internally              │
│     .databaseClient();    │   │                             │
│   db.insert(...)          │   │  functionUnderTest(params)  │
│   harness.send            │   │    └─► deps.databaseClient()│
│     .toHaveBeenCalled()   │   │    └─► deps.send()         │
│                           │   │                             │
└───────────────────────────┴───┴─────────────────────────────┘
```

**Why this matters:** When the test imports a dependency directly (e.g., `import { testDb } from "..."`) instead of using the harness-provided instance, it creates a second, disconnected dependency instance. The function under test uses one instance (from the harness) and the test asserts against another. This defeats dependency injection — it silently passes even when wiring is broken, and it couples tests to implementation details of how dependencies are constructed.

**Rule:** If a test needs to interact with a dependency (query a database, inspect a mock), it must obtain it from the harness. If no harness exists for that dependency, create one.

## Utilities

All harness utilities live in `../harness/`, resolved relative to the directory containing this document rather than the repository root.

### `combineHarnesses(...harnesses)`

Combines multiple harness functions into a single setup function. Harnesses run in order. Each receives `{ ...accumulatedResults, ...userOverrides }`. User overrides always take priority. Disposal runs in reverse order.

```ts
const setup = combineHarnesses(setupDbClient, setupUserRepository)

await using harness = await setup()
// harness has all keys from both harnesses
```

Each harness runs once per setup call, identified by its function reference, including shared dependencies inside nested combinations. Repeated references reuse accumulated results and register disposal only once. Separate setup calls run harnesses afresh.

Result keys must be unique across distinct harnesses — no two different harnesses should return the same property name.

Overrides are passed at call time:

```ts
await using harness = await setup({
  createDbClient: () => myCustomDb,
})
```

### Object dependencies

An **object dependency** is a plain object or class instance returned under a harness result key. Except for the deny-listed values below, `combineHarnesses` wraps its methods in place instead of replacing the value:

- String-keyed methods on the instance and its prototype chain up to `Object.prototype` are wrapped with `vi.fn`. `constructor` is never wrapped.
- Only data descriptors are wrapped — accessors are never invoked or replaced.
- Already-mocked functions are not re-wrapped.
- Identity and `instanceof` are preserved: the returned value is the same instance the harness created.
- `this` is preserved — a wrapped method still reads private fields.
- Functions, primitives, and deny-listed classes (`Array`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Date`, `RegExp`, `Promise`, `Error`, `ArrayBuffer`, and `ArrayBuffer` views) are never wrapped as object dependencies.

Because methods are `vi.fn`, tests can assert on them and use `.mockImplementation()`:

```ts
expect(harness.store.list()).toEqual([{ id: 'u1' }])
expect(harness.store.cancel).toHaveBeenCalledWith('u1')
```

Object dependency overrides merge **in place**: the override object's own enumerable properties are assigned onto the object after the producing harness returns, so later harnesses and the final harness result share the same instance. Sibling methods that are not overridden stay real.

```ts
await using harness = await setup({
  store: { list: () => ['override'] },
})

// harness.store.cancel is untouched and real;
// harness.store.list is the override above.
```

The harness for a factory is `{ ...deps, ...createX(deps) }`.

### `configureHarnesses(...setups)` / `configureHarnesses({ inferTypesFrom }, ...setups)`

Combines harnesses like `combineHarnesses`, but automatically types setup inputs from preceding harnesses. With `inferTypesFrom`, it also derives setup input types from `defaultDeps` and/or type-only harnesses up front. This avoids declaring a local `Deps` type in harness files.

```ts
export const setupPutIamRolePolicy = configureHarnesses(
  {
    inferTypesFrom: { defaultDeps: putIamRolePolicy.defaultDeps },
  },
  async (userDeps) => {
    const deps = await configureDependencies(
      { userDeps },
      {
        putRolePolicy: () => fromPartial({}),
      }
    )

    return {
      ...deps,
      putIamRolePolicy: withDeps(putIamRolePolicy, deps),
    }
  }
)
```

#### When to use `inferTypesFrom.harnesses`

`inferTypesFrom.harnesses` is type-only input for setup functions that run before a runtime harness has contributed its keys.

Do not list harnesses in `inferTypesFrom.harnesses` just because they appear later in the same `configureHarnesses(...)` call. Runtime harnesses passed as middle arguments already contribute their return types to the last setup function.

Use `inferTypesFrom.harnesses` only when an earlier setup function needs extra dependency keys that are not already present in `inferTypesFrom.defaultDeps`, before the harness that provides those keys runs. Include only the harnesses that contain those extra keys.

```ts
export const setupProvisionTenant = configureHarnesses(
  {
    inferTypesFrom: {
      defaultDeps: provisionTenant.defaultDeps,
      harnesses: [setupFetchInfraOutputs],
    },
  },
  async (userDeps) => ({
    ...(await configureDependencies(
      { userDeps },
      {
        describePrivateStorageStack: () => privateStorageStack,
      }
    )),
  }),
  setupFetchInfraOutputs,
  setupReconcileIamRole,
  async (deps) => ({
    ...deps,
    provisionTenant: withDeps(provisionTenant, deps),
  })
)
```

In the example above, `setupFetchInfraOutputs` appears in `inferTypesFrom.harnesses` only because the first setup function configures `describePrivateStorageStack` before `setupFetchInfraOutputs` runs. `setupReconcileIamRole` is not listed because it does not provide extra keys needed by that first setup function. The final setup function receives both runtime harnesses' keys without listing either harness in `inferTypesFrom.harnesses`.

### `withDeps(fn, deps)`

Binds a deps object to a function that takes `(params, deps)`, returning a function that only takes `params`. Simplifies the deps type so static properties like `defaultDeps` are stripped.

```ts
return {
  getUserById: withDeps(getUserById, deps),
}
```

## Writing a harness

### Leaf dependency (no sub-deps)

For a module with no injectable dependencies — create mock instances directly:

```ts
// createDbClient.harness.ts
import { type DbClient } from './createDbClient'

export async function setupDbClient() {
  // we don't have defaultDeps to infer types from
  const db: DbClient = {
    query: vi.fn(async () => []),
  }

  return {
    db,
    createDbClient: () => db,
  }
}
```

### Module with deps

For a module that has `defaultDeps` — use `configureHarnesses` to infer dependency types, compose sub-dependencies, then `withDeps` to bind them:

```ts
// tenantRepository.harness.ts
import { getTenantById, listTenants } from './tenantRepository'
import { setupDbClient } from './createDbClient.harness'
import { configureHarnesses } from '../configureHarnesses'
import { withDeps } from '../withDeps'

export const setupTenantRepository = configureHarnesses(
  {
    inferTypesFrom: {
      defaultDeps: getTenantById.defaultDeps,
    },
  },
  // reuse other module harnesses instead of re-mocking them
  setupDbClient,
  async (deps) => ({
    ...deps,
    getTenantById: withDeps(getTenantById, deps),
    listTenants: withDeps(listTenants, deps),
  })
)
```

Key points:

- `inferTypesFrom.defaultDeps` provides dependency types without declaring local `Deps` / `UserDeps` types.
- Runtime harnesses still need to be passed explicitly (`setupDbClient`) when they should run.
- `withDeps(getTenantById, deps)` binds deps without re-declaring parameter types.
- Spread `...deps` so downstream harnesses can access sub-dependencies.
- Do not call `configureDependencies(...)` with an empty configurator object just to pass through dependencies from composed harnesses. If the harness only binds functions to already-provided deps, use the `userDeps` received by the final setup directly.

#### When to use `configureDependencies`

`configureDependencies` serves two purposes:

1. **Consistent `userDeps` override handling.** When a test passes overrides via `setup({ someDep: ... })`, those overrides must take priority over default mocks. `configureDependencies` handles this for every key — without it, each harness would need manual `userDeps.dep ?? (() => defaultValue)` conditions for every dependency.
2. **Type-safe dependency mocking.** When dependency types cannot be inferred from `userDeps` alone, `inferTypesFrom` provides the full type information from `defaultDeps` and/or `harnesses`, so configurators are automatically typed and you can't accidentally mock a dependency with the wrong shape.

The simplest form of what `configureDependencies` replaces:

```ts
// What you'd have to write manually for each dependency
return {
  sendEmail: userDeps.sendEmail ?? (() => ({ messageId: faker.string.uuid() })),
  getUser: userDeps.getUser ?? (() => defaultUser),
}
```

With `configureDependencies`, the override logic is handled automatically:

```ts
const deps = configureDependencies(
  { userDeps },
  {
    sendEmail: () => ({ messageId: faker.string.uuid() }),
    getUser: () => defaultUser,
  }
)
```

**Rule:** Use `configureDependencies` when a setup function defines default dependency implementations. If it only forwards dependencies from composed harnesses or binds functions with `withDeps`, use the received `userDeps` directly; do not pass an empty configurator to `configureDependencies`. When all dependency types can be inferred from `userDeps`, `inferTypesFrom` is unnecessary. Otherwise, supply `inferTypesFrom` with `defaultDeps` and/or `harnesses` to provide the missing type information.

### Composed leaf dependency

When a dependency has no `defaultDeps` but needs internal structure (e.g., a factory that wraps an inner mock), use `configureHarnesses` to derive one part from another:

```ts
// createMailer.harness.ts
import { configureHarnesses } from '../configureHarnesses'
import type { Mailer } from './createMailer'

const setupTestDeps = async () => {
  const send: Mailer['send'] = vi.fn(async () => {})
  return { send }
}

export const setupCreateMailer = configureHarnesses(
  setupTestDeps,
  async (userDeps) => {
    const createMailer = vi.fn((): Mailer => ({ send: userDeps.send }))
    return { createMailer }
  }
)
```

This ensures `createMailer().send` is the same `send` mock the test can assert on, without annotating the second setup input.

## Harness design rules

### Defaults must produce valid results

A harness used without overrides must return functions that work end-to-end with placeholder data. Downstream consumers should not need to override every dep just to get a non-crashing baseline. If a harness default causes the function under test to throw immediately, every consumer is forced to reimplement setup logic, which defeats the purpose of the harness.

When using a module requires registration or initialization, perform those steps during harness setup rather than repeating them in every test. Tests should control these steps themselves only when their timing or outcome is part of the behavior being checked.

### Default data must be random

Harness defaults should generate structurally valid but **unstable** values using `faker` (or similar). Different test runs produce different defaults, so any test that accidentally asserts against harness-generated data fails intermittently and gets caught. This forces tests into one of two good patterns:

1. **Override with owned data** — the test passes specific values and asserts against them.
2. **Read back from the harness** — the test uses whatever the harness produced without coupling to a constant.

```ts
// BAD — stable defaults that tests silently couple to
const defaultOrder = { id: 'order-1', totalCents: 1200 }

// GOOD — use the owning module's fake factory
import { fakeOrder } from './order.fakes'
const defaultOrder = fakeOrder()
```

For domain data in harness defaults, reuse the colocated fake factories described in [Test data](writing-tests.md#test-data). Reuse existing fake factories for individual values as well, rather than duplicating them inside a harness.

### User deps are overrides, not defaults

`userDeps` exists to carry test overrides from `configureHarnesses(...)` into dependency mock helpers. Do not construct harness defaults by spreading `userDeps` and adding keys. Defaults belong in `configureDependencies(...)` configurators so they stay typed, discoverable, and separate from test-provided overrides.

```ts
// BAD — turns user overrides into default setup
const deps = await configureDependencies(
  { userDeps: { ...userDeps, getRole } },
  {}
)

// GOOD — userDeps only carries overrides; defaults stay in configurators
const deps = await configureDependencies(
  { userDeps },
  {
    getRole: () => defaultRole,
  }
)
```

If TypeScript reports `Not allowed. See src/tests/docs/testing-harness.md`, pass the original `userDeps` from the harness input and move default behavior into configurators.

### Anti-pattern: redefining configured dependencies

Put default dependency implementations in `configureDependencies` configurators, not in properties added to its result or in a spread at the injection site. Redefining a configured dependency bypasses its mock typing and overwrites test-provided overrides. Infer dependency types from the production function's `defaultDeps`, not from an object that replaces those functions with harness defaults; configurators supply the replacements while retaining the production dependency contract. Pass the resulting `deps` directly rather than changing production dependency types to accommodate incorrectly configured mocks.

```ts
// BAD — replacement functions become the type source
const harnessDefaultDeps = {
  ...notifyUser.defaultDeps,
  getUserById: async () => fakeUser(),
}
const deps = configureDependencies(
  { inferTypesFrom: { defaultDeps: harnessDefaultDeps }, userDeps },
  harnessDefaultDeps
)

// BAD — replaces the configured mock and ignores userDeps.createMailer
await notifyUser(params, {
  ...deps,
  createMailer: () => ({ send: userDeps.send }),
})

// GOOD — production types, with every replacement inside configurators
const deps = configureDependencies(
  { inferTypesFrom: { defaultDeps: notifyUser.defaultDeps }, userDeps },
  {
    getUserById: async () => fakeUser(),
    createMailer: () => ({ send: userDeps.send }),
  }
)

await notifyUser(params, deps)
```

### Expose domain-level seams in `defaultDeps`, not in harnesses

When a concrete test needs to replace distinct domain operations independently and those operations use the same generic dependency, define [semantic dependencies](dependency-injection.md#semantic-dependencies) in the implementation's `defaultDeps`. Different lifecycle stages alone do not justify new seams. Production code calls the named operations directly, such as `deps.finalizeRecord(...)`. The harness configures each operation separately instead of inspecting a generic dependency's arguments to determine which operation a call represents.

**Correct pattern:** semantic deps live in `defaultDeps`.

```ts
// saveRecord is a single generic function, but the orchestrator
// calls it at three different lifecycle stages.
import { saveRecord } from '../dal/records'

const defaultDeps = {
  initializeRecord: saveRecord,
  recordProgress: saveRecord,
  finalizeRecord: saveRecord,
}

export async function processRecord(params: ProcessParams, deps = defaultDeps) {
  const record = await deps.initializeRecord({
    id: params.id,
    record: { status: 'started' },
  })
  // ... do work ...
  await deps.recordProgress({ id: params.id, record: { progress: 100 } })
  // ... finalize ...
  await deps.finalizeRecord({ id: params.id, record: { status: 'complete' } })
}
```

```ts
// Harness — maps the sub-harness saveRecord mock to each semantic dep
export const setupProcessRecord = configureHarnesses(
  { inferTypesFrom: { defaultDeps: processRecord.defaultDeps, harnesses: [...] } },
  // ... sub-harnesses that provide saveRecord ...
  async (userDeps) => {
    const deps = await configureDependencies(
      { inferTypesFrom: { defaultDeps: processRecord.defaultDeps }, userDeps },
      {
        initializeRecord: userDeps.saveRecord,
        recordProgress: userDeps.saveRecord,
        finalizeRecord: userDeps.saveRecord,
      }
    );
    return { ...deps, processRecord: withDeps(processRecord, deps) };
  }
);
```

Tests override semantic deps directly without reimplementing routing:

```ts
await using harness = await setup({
  finalizeRecord: async () => completedRecord,
})
```

**Anti-pattern:** harness-only seams with dispatch logic. Do not keep a single generic dep in `defaultDeps` and create semantic routing in the harness by inspecting payload shapes or string matching on parameters. This makes the harness responsible for implementation details and forces every consumer to understand the routing rules.

```ts
// BAD — harness dispatches generic dep by inspecting params
const saveRecord = (params) => {
  if (params.record.status === 'complete') {
    return deps.finalizeRecord(params)
  }
  if (params.record.progress) {
    return deps.recordProgress(params)
  }
  return deps.initializeRecord(params)
}
```

### Derive types from `defaultDeps`, not from dependency packages

Harnesses and specs should derive types through `ReturnType<typeof fn.defaultDeps.someKey>` instead of importing types from the underlying dependency package. This keeps harnesses decoupled — if the dep signature changes, types update automatically.

```ts
// BAD — imports a type from the dependency package
import type { SomeCommandOutput } from "@some-sdk/client";
const mock = async (): Promise<SomeCommandOutput> => fromPartial({ ... });

// GOOD — derived from the dep's own type
type DepResult = ReturnType<typeof myFunction.defaultDeps.someKey>;
const mock = async (): DepResult => fromPartial({ ... });
```

## Working example

A full working example lives in `../harness/example/`, resolved relative to the directory containing this document:

| File | Role |
| --- | --- |
| `createDbClient.ts` | Database client factory |
| `createDbClient.harness.ts` | Mock db harness |
| `createMailer.ts` | Mailer factory |
| `createMailer.harness.ts` | Mock mailer harness (composed leaf) |
| `userRepository.ts` | User queries, depends on `createDbClient` |
| `userRepository.harness.ts` | Harness using `setupDbClient` + `withDeps` |
| `notifyUser.ts` | Notification logic, depends on `getUserById` + `createMailer` |
| `notifyUser.harness.ts` | Harness combining `setupUserRepository` + `setupCreateMailer` |
| `notifyUser.spec.ts` | Tests demonstrating overrides, mocking, and assertions |
