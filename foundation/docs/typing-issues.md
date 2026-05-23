# Typing Issues

Approaches for eliminating `as Something` type assertions, ordered by preference.

## 1. Narrow with a runtime type guard

Write a function that checks the shape at runtime and returns a type predicate. TypeScript narrows automatically after the call.

```ts
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

if (isStringArray(input)) {
  // input is string[] here, no assertion needed
}
```

## 2. Restructure control flow for built-in narrowing

TypeScript's native narrowing (`typeof`, `in`, `instanceof`, null checks) sometimes fails inside a single compound expression. Split into early returns or if-blocks so narrowing carries forward sequentially.

```ts
// Before — narrowing lost across && chain, assertion needed
return typeof value === 'object' && value !== null && Symbol.asyncDispose in (value as object);

// After — early return lets narrowing accumulate
if (value === null || typeof value !== 'object') return false;
return Symbol.asyncDispose in value;
```

## 3. Validate with Zod

Parse the value through a Zod schema. The output is fully typed with no assertion.

```ts
const ItemSchema = z.object({ id: z.string(), count: z.number() });

const item = ItemSchema.parse(raw); // typed as { id: string; count: number }
```

## 4. Use function overloads

Expose strict caller-facing overload signatures. Keep the implementation signature broad. The unsafe width stays inside one function body instead of leaking to every call site.

```ts
function transform(input: string): number;
function transform(input: string[]): number[];
function transform(input: string | string[]): number | number[] {
  // implementation operates on the union
}
```

## Decision order

1. Can a runtime type guard narrow the value?
2. Can restructuring control flow let built-in narrowing work?
3. Can a Zod schema validate and type the value?
4. Can overloads give callers a strict API while the implementation stays broad?

5. Is this stripping a type brand at its declaration site?
6. Is the function dynamically constructing a return value that matches a generic parameter?

If none apply, the type error likely points to a real design problem, not a TypeScript limitation.

## 5. Strip type brands at the declaration site

A type brand can be removed via `as` when the brand is declared in the same file or in `types.ts` in the same directory. The code that owns the brand understands its invariants and is the right authority to strip it.

```ts
// types.ts declares UserDepsMarkBrand
const userDeps = params.userDeps as Partial<Record<string, unknown>> | undefined;
```

Do not strip brands you don't own — external consumers must respect the brand.

## 6. Assert the return of generic dynamic construction

When a generic function dynamically constructs its return value — rebuilding an object from entries, accumulating results in a loop, merging multiple inputs — TypeScript cannot prove the output matches the generic parameter. This only applies when the function is generic and none of the above approaches can solve the issue. Use `as T` on the return and suppress the lint rule with an explanation.

```ts
// biome-ignore-start lint/plugin/no-type-assertions: dynamically constructed return cannot be proven to match T
return merged as T;
// biome-ignore-end lint/plugin/no-type-assertions: end
```

This is a last resort. The assertion must stay on the return statement inside the helper, never at call sites.

## Suppressing the lint rule

Use the range suppression format. Single-line `biome-ignore lint:` does not reliably suppress plugin rules across formatting.

```ts
// biome-ignore-start lint/plugin/no-type-assertions: reason
...
// biome-ignore-end lint/plugin/no-type-assertions: end
```

Both comments require a reason after the colon.
