import { type Mock, vi } from 'vitest'

export function isCallable(
  value: unknown
): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

export function wrapOnce<T extends (...args: never[]) => unknown>(
  fn: T
): Mock | T {
  // oxlint-disable typescript/consistent-type-assertions -- vi.fn requires a wider function type than the constrained T
  return vi.isMockFunction(fn)
    ? fn
    : vi.fn(fn as unknown as (...args: unknown[]) => unknown)
  // oxlint-enable typescript/consistent-type-assertions
}

const objectDenyList: unknown[] = [
  Array,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Date,
  RegExp,
  Promise,
  Error,
  ArrayBuffer,
]

/**
 * A wrappable object is any object not on the deny list. Its methods are
 * wrapped in place; functions are wrapped separately.
 */
export function isWrappableObject(
  value: unknown
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value)) return false
  // oxlint-disable typescript/consistent-type-assertions -- runtime check against deny-listed constructors cannot be typed without a cast
  return !objectDenyList.some((denied) => value instanceof (denied as Function))
  // oxlint-enable typescript/consistent-type-assertions
}

function collectMethodNames(object: object): Set<string> {
  const names = new Set<string>()
  for (
    let owner: object | null = object;
    owner !== null && owner !== Object.prototype;
    owner = Object.getPrototypeOf(owner)
  ) {
    for (const name of Object.getOwnPropertyNames(owner)) {
      if (name === 'constructor') continue
      names.add(name)
    }
  }
  return names
}

function findDataDescriptorValue(root: object, name: string): unknown {
  for (
    let owner: object | null = root;
    owner !== null;
    owner = Object.getPrototypeOf(owner)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    if (descriptor === undefined) continue
    return 'value' in descriptor ? descriptor.value : undefined
  }
  return undefined
}

/**
 * Wraps an object's methods in place, one level deep. String keys only,
 * `constructor` excluded, data descriptors only. Already-mocked functions
 * are not re-wrapped.
 */
export function wrapObjectMethods(object: object): void {
  for (const name of collectMethodNames(object)) {
    const original = findDataDescriptorValue(object, name)
    if (original === undefined || !isCallable(original)) continue
    if (vi.isMockFunction(original)) continue
    const wrapped = vi.fn((...args: unknown[]) => original.apply(object, args))
    Object.defineProperty(object, name, {
      value: wrapped,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
}
