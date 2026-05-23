import { expect, it } from 'vitest'
import { AsyncDisposableStack } from './asyncDisposableStack'

it('runs deferred callbacks in reverse order', async () => {
  const log: string[] = []
  const stack = new AsyncDisposableStack()

  stack.defer(async () => log.push('first'))
  stack.defer(async () => log.push('second'))
  stack.defer(async () => log.push('third'))

  await stack[Symbol.asyncDispose]()

  expect(log).toEqual(['third', 'second', 'first'])
})

it('accepts sync deferred callbacks', async () => {
  const log: string[] = []
  const stack = new AsyncDisposableStack()

  stack.defer(() => log.push('sync'))

  await stack[Symbol.asyncDispose]()

  expect(log).toEqual(['sync'])
})

it('is a no-op on second dispose', async () => {
  const log: string[] = []
  const stack = new AsyncDisposableStack()
  stack.defer(async () => log.push('once'))

  await stack[Symbol.asyncDispose]()
  await stack[Symbol.asyncDispose]()

  expect(log).toEqual(['once'])
})

it('throws after disposal when deferring', async () => {
  const stack = new AsyncDisposableStack()
  await stack[Symbol.asyncDispose]()

  expect(() => stack.defer(async () => {})).toThrow('already disposed')
})

it('collects multiple errors into an AggregateError', async () => {
  const stack = new AsyncDisposableStack()
  stack.defer(() => {
    throw new Error('a')
  })
  stack.defer(() => {
    throw new Error('b')
  })

  await expect(stack[Symbol.asyncDispose]()).rejects.toThrow(AggregateError)
})

it('throws the single error directly when only one callback fails', async () => {
  const stack = new AsyncDisposableStack()
  stack.defer(() => {})
  stack.defer(() => {
    throw new Error('only')
  })

  await expect(stack[Symbol.asyncDispose]()).rejects.toThrow('only')
})

it('runs remaining callbacks even when one throws', async () => {
  const log: string[] = []
  const stack = new AsyncDisposableStack()

  stack.defer(async () => log.push('first'))
  stack.defer(() => {
    throw new Error('boom')
  })
  stack.defer(async () => log.push('third'))

  await stack[Symbol.asyncDispose]().catch(() => {})

  expect(log).toEqual(['third', 'first'])
})
