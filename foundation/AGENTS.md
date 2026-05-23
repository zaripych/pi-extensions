# Agents

Project-level instructions for AI coding agents.

## Overrides

Load and respect @AGENTS.local.md contents and instructions if it exists.

## Verification

Before shipping, run the full verification suite:

```sh
npm run verify
```

This runs, in order:

1. `npm run typecheck` — TypeScript type checking (`tsc --noEmit`)
2. `npm run lint` — Biome linting/format checks
3. `npm run test -- --changed` — Vitest tests on changed files only

You can also run each step individually.

## TypeScript Conventions

- **No import-time side effects.** Declaring primitive constants and plain
  objects at module scope (`const value = ...`) is fine. But creating
  dependencies — database connections, SDK clients, loggers with transports,
  etc. — must be done lazily via functions. Use `once` or `onceAsync` from
  `src/utils/` to guarantee a dependency is created exactly once while still
  deferring work to first access.

  ```ts
  // BAD — connection opened at import time
  const redis = new Redis(config.redisUrl)

  // GOOD — deferred to first call, created once
  import { once } from '@/utils/once'
  const getRedis = once(() => new Redis(config.redisUrl))
  ```

- **No default exports.** Always use named exports. Default exports lose the
  canonical name at the import site and make automated refactoring harder.
  Next.js route files (`page.tsx`, `layout.tsx`, etc.) are the only exception —
  they require default exports by convention.

- **Single params object.** All functions take at most two parameters. The first
  is a named params object (never positional args). The second, if present, is
  always `deps` (see [Dependency Injection](#dependency-injection)). This keeps
  call sites readable and scales when new parameters are added.

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

  Functions with exactly one input value may take that value directly when the
  function name makes the parameter role obvious, e.g. `ensureTruthy(value)`,
  `ensureDefined(value)`, `parseJson(value)`. If a second parameter is ever
  needed, refactor to a named params object as the first parameter and `deps` as
  the optional second parameter.

  ```ts
  // GOOD — single obvious input value
  ensureTruthy(value)
  ```

- **No excessive comments.** Function and variable names should be descriptive
  and tell the story. Do not add comments that restate what the code already
  says. No module-level doc comments at the top of files. This rule does not
  mean existing comments must be proactively removed.

- **No re-exporting.** Never re-export a constant, function, class, or type —
  whether from another module or at a different location in the same module.
  Every symbol has a single source of truth. Re-exporting creates confusion
  about where things are defined.

- **Export at the definition site.** Every exported symbol must have `export` on
  its declaration. Do not declare a symbol and then export it in a separate
  `export { ... }` or `export type { ... }` statement elsewhere in the file.

- **Types are private by default.** Do not export types unless a consumer
  outside the module actually needs them. Consumers should infer types from
  return values of functions and APIs (e.g.,
  `Awaited<ReturnType<typeof insertTenant>>`). Only export a type when inference
  is impossible or impractical. Domain entities in the `entities` directory are
  exempt — they span multiple application layers and are exported by design.

- **No barrel files.** Do not create `index.ts` files that aggregate and
  re-export from sibling modules. Barrel files add unnecessary indirection, slow
  down type checking and bundling, and obscure where symbols originate.

- **No star imports.** Do not use namespace imports like
  `import * as values from "..."`. Star imports create a barrel-like grab bag at
  the import site, obscure which symbols are actually used, and make automated
  refactoring harder. Import named symbols explicitly. Exception: a namespace
  import is allowed when an external API requires the complete module object as
  a keyed registry and the imported namespace is passed through as that
  registry, not dereferenced for individual members.

- **Module name matches main export.** The file name must match the primary
  exported symbol: `notifyUser` → `notifyUser.ts` (test harness file name is an
  exception to this rule - `notifyUser.harness.ts` and `setupNotifyUser(...)`).

- **No renaming symbols.** When a symbol is passed between functions,
  destructured, or returned from a harness, keep the original name — never
  rename it. These names form stable dependency keys and searchable keywords
  across the codebase.

- **No type assertions.** `something as SomethingElse` and
  `<SomethingElse>something` are not allowed. Use type guards instead. The one
  exception is `as unknown` followed by a runtime type guard — a function that
  tests runtime properties to narrow the type, providing both type-narrowing and
  runtime consequences. `as const` is allowed for literal narrowing. For
  approaches to fixing `as Something` violations, see
  [Typing Issues](docs/typing-issues.md).

- **No non-null assertions.** Never use `!` to bypass nullable or undefined
  types. In tests, prefer optional chaining for direct expectations, e.g.
  `expect(result?.updatedAt).toBeInstanceOf(Date)`. When code needs a non-null,
  defined, or truthy value, assert it explicitly with `ensureNotNull`,
  `ensureDefined`, or `ensureTruthy` from `src/correctness/`.

- **Validate external payloads with Zod.** Any payload arriving from outside the
  process — network, file, API, or inter-process — must be validated with a Zod
  schema. This applies even to payloads from processes and applications we
  maintain, since code evolves independently and shapes can drift.

- **No unvalidated `any` or `unknown`.** Every value typed `any` or `unknown`
  must be validated with a Zod schema or a runtime type guard before use, even
  when it comes from an internal trusted source.

## Dependency Injection

Use the `deps` second-parameter pattern for all new functions and classes that
have external dependencies (database, external clients, etc.). See
[\*\*/testing/docs/dependency-injection.md](testing/docs/dependency-injection.md)
for the full spec, rules, and examples.

## Testing Harnesses

Harnesses must be used in tests when the system under test has dependencies. See
[\*\*/testing/docs/testing-harness.md](testing/docs/testing-harness.md) for the
full spec, rules, and examples.
