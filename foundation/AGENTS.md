# Agents

Project-level instructions for AI coding agents.

## Overrides

Load and respect @AGENTS.local.md contents and instructions if it exists.

## Verification

When your task changes only Markdown files, skip the verification suite and format only the files you edited with `pnpm exec prettier --write <files>`. For code changes, run the full verification suite before shipping:

```sh
pnpm run verify
```

This runs in parallel, bailing on the first failure:

1. `pnpm run typecheck` — TypeScript type checking (`tsgo --noEmit`)
2. `pnpm run lint` — Oxlint checks
3. `pnpm run test-changed` — Vitest tests on changed files only

You can also run each step individually.

## Readability and Maintainability

- **Reuse before adding.** Before introducing a helper, wrapper, harness, or dependency, search for existing functionality and inspect how it is used. Reuse what already meets the requirement rather than creating a parallel implementation or wiring path.

## TypeScript Conventions

- **No import-time side effects.** Declaring primitive constants and plain objects at module scope (`const value = ...`) is fine. But creating dependencies — database connections, SDK clients, loggers with transports, etc. — must be done lazily via functions. Use `once` or `onceAsync` from `src/utils/` to guarantee a dependency is created exactly once while still deferring work to first access.

  ```ts
  // BAD — connection opened at import time
  const redis = new Redis(config.redisUrl)

  // GOOD — deferred to first call, created once
  import { once } from '@/utils/once'
  const getRedis = once(() => new Redis(config.redisUrl))
  ```

- **No default exports.** Always use named exports. Default exports lose the canonical name at the import site and make automated refactoring harder. Next.js route files (`page.tsx`, `layout.tsx`, etc.) are the only exception — they require default exports by convention.

- **Single params object.** All functions take at most two parameters. The first is a named params object (never positional args). The second, if present, is always `deps` (see [Dependency Injection](#dependency-injection)). This keeps call sites readable and scales when new parameters are added.

  ```ts
  // BAD — positional args are opaque at the call site
  functionCall(0, true, 'Peter')

  // GOOD — named params object
  functionCall({
    tolerance: 0,
    highPrecision: true,
    criteria: 'Peter',
  })
  ```

  Functions with exactly one input value may take that value directly when the function name makes the parameter role obvious, e.g. `ensureTruthy(value)`, `ensureDefined(value)`, `parseJson(value)`. A single cohesive object may also be passed directly when the object has its own clear named concept, not when it is just a loose bag of unrelated parameters.

  ```ts
  // GOOD — single obvious input value
  ensureTruthy(value)

  // GOOD — single cohesive object with a clear named concept
  renderInvoice(invoice)

  // BAD — primitive flag is opaque at the call site
  deleteProject(false)

  // GOOD — flag meaning is explicit
  deleteProject({ forceDelete: false })
  ```

  If a second parameter is ever needed, refactor to a named params object as the first parameter and `deps` as the optional second parameter.

- **No excessive comments.** Function and variable names should be descriptive and tell the story. Do not add comments that restate what the code already says. No module-level doc comments at the top of files. This rule does not mean existing comments must be proactively removed.

- **Respect function receivers.** Use `this` only in class-instance implementations. Use arrow-function properties for receiver-free object APIs and callbacks, including function-property signatures in their types. Do not suppress `unbound-method` or add `this: void` when an arrow function can express the API. Introduce explicit receiver typing only when arrow functions cannot express the required contract. When passing a class-instance method that uses `this` as a callback, bind it to its instance or invoke it through an arrow wrapper.

- **No re-exporting.** Never re-export a constant, function, class, or type — whether from another module or at a different location in the same module. Every symbol has a single source of truth. Re-exporting creates confusion about where things are defined.

- **Export at the definition site.** Every exported symbol must have `export` on its declaration. Do not declare a symbol and then export it in a separate `export { ... }` or `export type { ... }` statement elsewhere in the file.

- **Types are private by default.** Do not export types unless a consumer outside the module actually needs them. Consumers should infer types from return values of functions and APIs (e.g., `Awaited<ReturnType<typeof insertTenant>>`). Only export a type when inference is impossible or impractical. Domain entities in the `entities` directory are exempt — they span multiple application layers and are exported by design.

- **No barrel files.** Do not create `index.ts` files that aggregate and re-export from sibling modules. Barrel files add unnecessary indirection, slow down type checking and bundling, and obscure where symbols originate.

- **No star imports.** Do not use namespace imports like `import * as values from "..."`. Star imports create a barrel-like grab bag at the import site, obscure which symbols are actually used, and make automated refactoring harder. Import named symbols explicitly. Exception: a namespace import is allowed when an external API requires the complete module object as a keyed registry and the imported namespace is passed through as that registry, not dereferenced for individual members.

- **Module name matches main export.** The file name must match the primary exported symbol: `notifyUser` → `notifyUser.ts` (test harness file name is an exception to this rule - `notifyUser.harness.ts` and `setupNotifyUser(...)`).

- **No renaming symbols.** When a symbol is imported, passed between functions, destructured, or returned from a harness, keep its original name — never rename it. Consistent names make data flow traceable across the application without requiring readers to translate between local aliases.

- **No type assertions.** `something as SomethingElse` and `<SomethingElse>something` are not allowed. Use type guards instead. The one exception is `as unknown` followed by a runtime type guard — a function that tests runtime properties to narrow the type, providing both type-narrowing and runtime consequences. `as const` is allowed for literal narrowing. For approaches to fixing `as Something` violations, read [Typing Issues](docs/typing-issues.md), resolving the path relative to the directory containing this AGENTS.md file, following any symlinks to their target first.

- **No non-null assertions.** Never use `!` to bypass nullable or undefined types. In tests, prefer optional chaining for direct expectations, e.g. `expect(result?.updatedAt).toBeInstanceOf(Date)`. When code needs a non-null, defined, or truthy value, assert it explicitly with `ensureNotNull`, `ensureDefined`, or `ensureTruthy` from `src/correctness/`.

- **Validate external payloads with Zod.** Any payload arriving from outside the process — network, file, API, or inter-process — must be validated with a Zod schema. This applies even to payloads from processes and applications we maintain, since code evolves independently and shapes can drift.

- **No unvalidated `any` or `unknown`.** Every value typed `any` or `unknown` must be validated with a Zod schema or a runtime type guard before use, even when it comes from an internal trusted source.

- **Event-driven waiting.** When an operation exposes events, await an event matching an explicit criterion rather than sleeping or polling. Subscribe before starting the operation. Use `await using` for automatic subscription cleanup where supported, and timeouts to bound failure.

  ```ts
  import { on } from 'node:events'

  // Prefer a typed EventEmitter or discriminated union event payloads.
  await using completions = on(events, 'job-completed', {
    signal: AbortSignal.timeout(1_000),
  })

  await startJob({ id })

  for await (const [jobId] of completions) {
    if (typeof jobId === 'string' && jobId === id) break
  }
  ```

## Dependency Injection

Dependency-injection code defines, receives, or wires replaceable dependencies, including through `defaultDeps`, `deps`, and `runtimeDeps`. Before creating or changing this code, read `testing/docs/dependency-injection.md` in full. Resolve this path relative to the directory containing this AGENTS.md file, following any symlinks to their target first. Follow that specification to determine whether dependency injection is needed and which pattern applies.

## Writing Tests

Before creating or changing tests, read `testing/docs/writing-tests.md` in full. Resolve this path relative to the directory containing this AGENTS.md file, following any symlinks to their target first.

## Testing Harnesses

Harnesses must be used in tests when the system under test has dependencies. Before creating or changing such tests or their harnesses, read `testing/docs/testing-harness.md` in full. Resolve this path relative to the directory containing this AGENTS.md file, following any symlinks to their target first.
