import type { AnyFunction, SimplifyDeps, StripUserDepsMark } from './types'

function extractParamNames(fn: AnyFunction): string[] {
  const source = fn.toString()
  const openParen = source.indexOf('(')
  if (openParen === -1) return []

  let depth = 0
  let closeParen = -1
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) {
        closeParen = i
        break
      }
    }
  }
  if (closeParen === -1) return []

  const paramList = source.slice(openParen + 1, closeParen).trim()
  if (paramList === '') return []

  return paramList.split(',').map((p) => {
    const name = p.trim().split(/[=\s]/)[0]
    if (!name) {
      throw new Error(`Failed to extract parameter name from "${p}"`)
    }
    return name
  })
}

function assertDepsParam(fn: AnyFunction): void {
  const params = extractParamNames(fn)
  const depsIndex = fn.length === 0 ? 0 : 1
  const paramName = params[depsIndex]
  if (paramName !== 'deps') {
    throw new Error(
      `withDeps expects the deps parameter to be named "deps", but parameter ${depsIndex} of ${fn.name || '(anonymous)'} is named "${paramName}"`
    )
  }
}

/**
 * Binds a deps object to a function, returning a function without the deps parameter.
 *
 * Supports two signatures:
 * - `(params, deps = defaultDeps)` → returns `(params) => R`
 * - `(deps = defaultDeps)` → returns `() => R`
 *
 * Asserts at runtime that the deps parameter is named "deps".
 *
 * Simplifies the deps type so that function-typed entries are reduced
 * to their call signature — static properties like `defaultDeps` are
 * stripped. This lets harnesses pass plain functions where the
 * original deps type expects `typeof someFunction`.
 */
export function withDeps<D, R>(
  fn: (deps: D) => R,
  deps: NoInfer<StripUserDepsMark<SimplifyDeps<D>>>
): () => R

export function withDeps<P, D, R>(
  fn: (params: P, deps: D) => R,
  deps: NoInfer<StripUserDepsMark<SimplifyDeps<D>>>
): (params: P) => R

export function withDeps(fn: AnyFunction, deps: unknown): AnyFunction {
  assertDepsParam(fn)
  // oxlint-disable typescript/consistent-type-assertions -- implementation signature bridges overloads — callers are type-checked by the overload signatures above
  const call = fn as (...args: unknown[]) => unknown
  // oxlint-enable typescript/consistent-type-assertions
  if (fn.length === 0) {
    return () => call(deps)
  }
  return (params: unknown) => call(params, deps)
}
