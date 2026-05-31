import { describe, expectTypeOf, it } from 'vitest'
import type { UnreachableError } from './UnreachableError'

describe('UnreachableError', () => {
  it('requires a never value', () => {
    expectTypeOf<ConstructorParameters<typeof UnreachableError>>().toEqualTypeOf<
      [value: never]
    >()
  })
})
