import { type Mock, vi } from 'vitest'

export function isCallable(
  value: unknown
): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

export function wrapOnce<T extends (...args: never[]) => unknown>(
  fn: T
): Mock | T {
  // biome-ignore-start lint/plugin/no-type-assertions: vi.fn requires a wider function type than the constrained T
  return vi.isMockFunction(fn)
    ? fn
    : vi.fn(fn as unknown as (...args: unknown[]) => unknown)
  // biome-ignore-end lint/plugin/no-type-assertions: end
}
