# Dependency Injection

## Precondition

Do not introduce seams before you have a test that needs them. You cannot know
the right dependency boundaries until a test forces you to inject something. If
you write the implementation first, call dependencies directly — no
`defaultDeps`, no `deps` parameter. When you later write a test that needs to
replace one of those calls, come back and introduce the seam at that point.
Speculative seams based on what _might_ need mocking lead to wrong abstractions
and wasted harness work.

## Overview

Dependencies (database clients, external service clients, clocks, etc.) are
injected via a second `deps` parameter with a module-level default. This gives
tests a seam to replace real dependencies with mocks without sharing mutable
state between tests.

## Rules

1. **`deps` is the second parameter**, after the business params. It always
   receives `defaultDeps` as its default value.
2. **Test-only seam.** Production code never passes custom deps. The `deps`
   parameter exists exclusively for tests.
3. **Justify every seam.** Each entry in `defaultDeps` must exist because tests
   need to replace it. If no test mocks a dependency, it shouldn't be a seam —
   call it directly or fold it into another dep's default implementation. When a
   dep is justified, shape its interface (params and return type) to what the
   consumer actually uses, not the full API of the underlying implementation.
4. **Not for polymorphic behavior in production.** Do not use `deps` to
   implement feature flags, environment branching, or runtime strategy selection
   in production code.
5. **All-or-nothing.** Every `deps` property is required — no `Partial<Deps>`.
   Callers must supply the full deps object or omit it entirely to get the
   default. This prevents accidentally inheriting a real dependency in a test.
6. **Entries are always functions** (sync or async). Never constants or direct
   references to objects. This makes them compatible with `vi.fn()` and similar
   test utilities.
7. **`defaultDeps` is module-level, never exported.** The function or class
   exposes it as a static property so tests can reference it without importing a
   separate symbol.
8. **Tests never spy on `defaultDeps`.** Tests inject a full mock deps object.
   Spying on `defaultDeps` is an anti-pattern — it mutates shared module state
   and leaks between tests if cleanup is missed.

## Functions (preferred)

Functions with a static `defaultDeps` property are the preferred style over
classes.

```ts
import database, { type DbClient } from '@/db'

// Module-level, not exported
const defaultDeps = {
  db: () => database,
}

type Deps = typeof defaultDeps

export async function getTenantById(
  params: { id: string },
  deps: Deps = defaultDeps
) {
  const db = deps.db()
  // ...
}

// Expose for tests
getTenantById.defaultDeps = defaultDeps
```

## Functions without params

When a function has no business params, `deps` is the only parameter.

```ts
import { getConfigPaths } from './getConfigPaths'
import { readFile } from 'node:fs/promises'

const defaultDeps = {
  getConfigPaths,
  // Narrows readFile to the specific overload we use
  readFile: (path: string) => readFile(path, 'utf-8'),
}

export async function resolveSettings(deps = defaultDeps) {
  const paths = deps.getConfigPaths()
  const content = await deps.readFile(paths.settingsPath)
  // ...
}

resolveSettings.defaultDeps = defaultDeps
```

## Classes

Same pattern — `deps` is the second constructor parameter.

```ts
import database, { type DbClient } from '@/db'
import { someClient } from '@/lib/someClient'

const defaultDeps = {
  db: () => database,
  getClient: () => someClient,
}

type Deps = typeof defaultDeps

export class TenantService {
  static defaultDeps = defaultDeps

  constructor(
    private readonly config: { region: string },
    private readonly deps: Deps = defaultDeps
  ) {}

  async findTenant(id: string) {
    const db = this.deps.db()
    // ...
  }
}
```

## Anti-patterns

### ❌ Exporting `defaultDeps`

```ts
// BAD — exposes an import that invites spying on shared state
export const defaultDeps = { db: () => database }
```

### ❌ Partial deps

```ts
// BAD — allows accidentally inheriting a real dependency in tests
function getTenantById(params: Params, deps: Partial<Deps> = defaultDeps)
```

### ❌ Constants or direct references in deps

```ts
// BAD — not replaceable with vi.fn()
const defaultDeps = { db: database }
```

### ❌ Spying on defaultDeps

```ts
// BAD — mutates shared module state, leaks between tests
vi.spyOn(getTenantById.defaultDeps, 'db').mockReturnValue(mockDb)
```

### ❌ Stubs in `defaultDeps`

Do not add placeholder functions to `defaultDeps` before the production behavior
exists. A dependency seam should wrap real behavior that the function already
uses and that tests need to replace. Empty stubs make tests pass against a fake
future design instead of current behavior, and they turn `defaultDeps` into a
TODO list rather than a description of real dependencies.

```ts
// BAD — enqueueReceipt is only a placeholder, not implemented behavior
async function enqueueReceipt(_params: { orderId: string }): Promise<void> {}

const defaultDeps = {
  saveOrder,
  enqueueReceipt,
}

export async function checkout(params: CheckoutParams, deps = defaultDeps) {
  const order = await deps.saveOrder(params)
  await deps.enqueueReceipt({ orderId: order.id })
}
```

Wait until `enqueueReceipt` has real production behavior, then introduce it as a
dependency in the same change as the behavior that needs to replace it in tests.

### ❌ Overriding types in `defaultDeps`

Do not wrap a dependency in a lambda just to change its type signature. This
creates two problems:

- Every injection site must manually maintain a type annotation that duplicates
  (or widens) the original.
- If the overridden type is partially compatible with the original, invalid
  types propagate into tests silently.

Assign the dependency directly and let TypeScript infer the type from the
source.

```ts
import { databaseClient, type DbClient } from '@/db'

// BAD — wraps the dependency to widen the return type
const defaultDeps = {
  databaseClient: (): DbClient => databaseClient(),
}

// GOOD — assign directly, type inferred from the source
const defaultDeps = {
  databaseClient,
}
```

The one exception is when a dependency's API surface is too large (e.g. many
overloads) and you want to narrow it to a specific signature:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// OK — narrows execFileAsync to the specific overload we use,
// so tests don't have to deal with all possible signatures
const defaultDeps = {
  execFileAsync: (
    file: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string }> => execFileAsync(file, args),
}
```

### ❌ Fat dependency interface

Both sides of a dep's interface — parameters and return type — should be shaped
to what the consumer actually uses. A fat interface forces harnesses to
construct unnecessary data, obscures what the function depends on, and violates
the Law of Demeter by coupling the consumer to structures it doesn't need to
know about.

**Fat output** — dep returns more than the consumer uses:

```ts
// BAD — consumer only uses emailAddress, but dep returns the full user
const defaultDeps = {
  getUserProfile,
}

async function sendReminder(
  params: { userId: string },
  deps: Deps = defaultDeps
) {
  const profile = await deps.getUserProfile({ id: params.userId })
  await send({ to: profile.emailAddress, body: '...' })
}

// GOOD — dep shaped to what the consumer needs
const defaultDeps = {
  fetchRecipientEmail: async (params: {
    userId: string
  }): Promise<{ emailAddress: string }> => {
    const profile = await getUserProfile({ id: params.userId })
    return { emailAddress: profile.emailAddress }
  },
}
```

**Fat input** — consumer passes a large object when the dep only needs part of
it:

```ts
// BAD — dep receives the full tenant, but only needs the bucket name
const defaultDeps = {
  listObjects: async (params: { tenant: Tenant }) => {
    return s3ListObjects({ bucket: params.tenant.bucket })
  },
}

// GOOD — consumer extracts what the dep needs
const defaultDeps = {
  listObjects: async (params: { bucket: string }) => {
    return s3ListObjects({ bucket: params.bucket })
  },
}
```

### ❌ Unnecessary seam on a thin wrapper

Don't add `defaultDeps` to a function that is itself a thin wrapper with no
business logic — one whose entire body is a single SDK or library call. The
`deps` pattern exists so tests can replace external calls without changing
behaviour. When the function _is_ that external call, the seam belongs one level
up in the consumer, not inside the wrapper.

The right move is to export the function as a plain async function and let the
consumer (an orchestrator, a service, etc.) list it as a dep. The consumer's
harness then mocks it with `vi.fn()` directly.

```ts
// BAD — sendEmail wraps a single transporter.sendMail call.
// The dep just mirrors the function's own params, adding no value.
const defaultDeps = {
  sendMail: async (params: { to: string; subject: string; html: string }) => {
    await transporter.sendMail(params)
  },
}

export async function sendEmail(
  params: { to: string; subject: string; html: string },
  deps: Deps = defaultDeps
) {
  await deps.sendMail(params)
}

sendEmail.defaultDeps = defaultDeps

// GOOD — no deps; the transport call is inlined.
// The consumer (e.g. notifyUser) lists sendEmail in its own defaultDeps
// and the consumer's harness mocks it via vi.fn().
export async function sendEmail(params: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  await transporter.sendMail(params)
}
```

Signals that a function is a thin wrapper and should not have `defaultDeps`:

- The body is a single `await client.send(...)` or equivalent SDK call.
- Every entry in `defaultDeps` exactly mirrors the function's own parameter
  shape.
- The function has no conditional logic, transformation, or error handling of
  its own.
- No test ever needs to assert on the internal dep — only on whether the
  function itself was called.

### ❌ Unnecessary intermediary seam

Don't elevate a function to a dep just because it sits between the consumer and
an external call. If the intermediary is pure or deterministic and no test
benefits from mocking it, call it directly and fold it into the dep that wraps
the actual external dependency.

```ts
// BAD — resolveEndpoint is pure, no test needs to mock it,
// but it's a separate seam that every harness must configure
const defaultDeps = {
  resolveEndpoint,
  fetchHealthStatus,
}

async function checkService(params: { env: string }, deps: Deps = defaultDeps) {
  const endpoint = deps.resolveEndpoint({ env: params.env })
  return deps.fetchHealthStatus({ url: endpoint.url })
}

// GOOD — pure lookup folded into the dep that needs it
const defaultDeps = {
  fetchHealthStatus: async (params: { env: string }) => {
    const endpoint = resolveEndpoint(params)
    return fetchHealthStatusImpl({ url: endpoint.url })
  },
}
```

### ❌ Using deps for production polymorphism

```ts
// BAD — deps is a test seam, not a strategy pattern
const prodDeps = isStaging ? stagingDeps : productionDeps
doSomething(params, prodDeps)
```

## Consolidating sibling functions into a factory

When multiple exported functions share the same `defaultDeps`, accept
overlapping parameters, and follow the same internal pattern, they are
candidates for consolidation into a single factory function. The factory
captures the shared parameters and deps once, and returns an object whose
methods supply only the varying parts.

Signals to look for:

- Two or more functions with identical `defaultDeps`
- Repeated parameters across their signatures
- Duplicated logic (validation, error handling, tag construction)
- Consumers always call both functions with the same shared values

Before — two functions with identical deps and duplicated bodies:

```ts
const defaultDeps = { sendMessage }

export async function notifyByEmail(
  params: { userId: string; locale: string; body: string },
  deps: Deps = defaultDeps
) {
  const formatted = formatForEmail({
    body: params.body,
    locale: params.locale,
  })
  await deps.sendMessage({
    userId: params.userId,
    channel: 'email',
    content: formatted,
  })
}

notifyByEmail.defaultDeps = defaultDeps

export async function notifyBySms(
  params: { userId: string; locale: string; body: string },
  deps: Deps = defaultDeps
) {
  const formatted = formatForSms({ body: params.body, locale: params.locale })
  await deps.sendMessage({
    userId: params.userId,
    channel: 'sms',
    content: formatted,
  })
}

notifyBySms.defaultDeps = defaultDeps
```

Problems: `userId` and `locale` are threaded through every call site. The
send-and-format pattern is duplicated. Consumers spread
`notifyByEmail.defaultDeps` plus both functions into their own `defaultDeps`,
creating three dep keys for what is conceptually one capability. Every harness
must mock all three.

After — a factory captures shared params, methods supply only the varying part:

```ts
const defaultDeps = { sendMessage }

export function createNotifier(
  params: { userId: string; locale: string },
  deps: Deps = defaultDeps
) {
  const { userId, locale } = params

  async function notify(params: {
    channel: string
    format: (body: string) => string
    body: string
  }) {
    const content = params.format(params.body)
    await deps.sendMessage({ userId, channel: params.channel, content })
  }

  return {
    notifyByEmail: (params: { body: string }) =>
      notify({
        channel: 'email',
        format: (b) => formatForEmail({ body: b, locale }),
        body: params.body,
      }),
    notifyBySms: (params: { body: string }) =>
      notify({
        channel: 'sms',
        format: (b) => formatForSms({ body: b, locale }),
        body: params.body,
      }),
  }
}

createNotifier.defaultDeps = defaultDeps
```

Consumers go from three dep keys (`sendMessage`, `notifyByEmail`, `notifyBySms`)
to two (`sendMessage`, `createNotifier`), and shared parameters are supplied
once at factory creation rather than repeated per call.

## Test harnesses

For how to build composable test harnesses that inject mock deps into functions
and classes, see [testing-harness.md](testing-harness.md).
