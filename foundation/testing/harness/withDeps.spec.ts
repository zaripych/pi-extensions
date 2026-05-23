import { expectTypeOf } from 'expect-type'
import { describe, expect, it } from 'vitest'
import { withDeps } from './withDeps'

describe('two-parameter functions (params, deps)', () => {
  it('binds deps and returns a function that only takes params', () => {
    function greet(params: { name: string }, deps = { prefix: 'Hi' }): string {
      return `${deps.prefix} ${params.name}`
    }

    const bound = withDeps(greet, { prefix: 'Hello' })

    expect(bound({ name: 'World' })).toBe('Hello World')
  })

  it('preserves generic type parameter of the input function', () => {
    function identity<T>(
      params: { value: T },
      deps = { log: (_msg: string) => {} }
    ): T {
      deps.log('called')
      return params.value
    }

    const bound = withDeps(identity, { log: () => {} })

    const numResult = bound({ value: 42 })
    const strResult = bound({ value: 'hello' })

    expect(numResult).toBe(42)
    expect(strResult).toBe('hello')

    expectTypeOf(numResult).toEqualTypeOf<number>()
    expectTypeOf(strResult).toEqualTypeOf<string>()
  })
})

describe('single-parameter functions (deps)', () => {
  it('binds deps and returns a zero-argument function', () => {
    function loadConfig(deps = { path: '/default' }): string {
      return deps.path
    }

    const bound = withDeps(loadConfig, { path: '/test' })

    expect(bound()).toBe('/test')
  })
})

describe('deps parameter name assertion', () => {
  it('throws when second parameter is not named deps', () => {
    function greet(
      params: { name: string },
      options = { prefix: 'Hi' }
    ): string {
      return `${options.prefix} ${params.name}`
    }

    expect(() => withDeps(greet, { prefix: 'Hello' })).toThrow(
      /expects the deps parameter to be named "deps".*is named "options"/
    )
  })

  it('throws when single parameter is not named deps', () => {
    function loadConfig(options = { path: '/default' }): string {
      return options.path
    }

    expect(() => withDeps(loadConfig, { path: '/test' })).toThrow(
      /expects the deps parameter to be named "deps".*is named "options"/
    )
  })
})
