import { expect, it } from 'vitest'
import { combineHarnesses } from './combineHarnesses'

type User = {
  id: string
  name: string
}

type LoadUser = () => Promise<User>

it('merges function results from multiple harnesses', async () => {
  const loadUser = async () => ({ id: 'user-1', name: 'Alice' })
  const loadSettings = async () => ({ theme: 'dark' })

  const setupUser = async () => ({ loadUser })
  const setupSettings = async () => ({ loadSettings })

  const setup = combineHarnesses(setupUser, setupSettings)
  await using harness = await setup()

  expect(await harness.loadUser()).toEqual({ id: 'user-1', name: 'Alice' })
  expect(await harness.loadSettings()).toEqual({ theme: 'dark' })
})

it('passes accumulated function results to subsequent harnesses', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'user-1', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup()

  expect(await harness.loadProfile()).toEqual({
    user: { id: 'user-1', name: 'Alice' },
  })
})

it('passes mock-wrapped accumulated functions to subsequent harnesses', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'user-1', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup()

  await harness.loadProfile()

  expect(harness.loadUser).toHaveBeenCalledWith()
})

it('user override functions take priority over harness functions', async () => {
  const setupUser = async () => ({
    loadUser: async () => ({ id: 'original-user', name: 'Alice' }),
  })
  const setupProfile = async (deps: { loadUser: LoadUser }) => ({
    loadProfile: async () => ({ user: await deps.loadUser() }),
  })

  const setup = combineHarnesses(setupUser, setupProfile)
  await using harness = await setup({
    loadUser: async () => ({ id: 'override-user', name: 'Bob' }),
  })

  expect(await harness.loadProfile()).toEqual({
    user: { id: 'override-user', name: 'Bob' },
  })
})

it('works with no overrides and no disposables', async () => {
  const setupClock = async () => ({
    getCurrentTime: () => new Date('2024-01-01T00:00:00.000Z'),
  })

  const setup = combineHarnesses(setupClock)
  await using harness = await setup()

  expect(harness.getCurrentTime()).toEqual(new Date('2024-01-01T00:00:00.000Z'))
})

it('accepts a sync harness', async () => {
  const setupClock = () => ({
    getCurrentTime: () => new Date('2024-01-01T00:00:00.000Z'),
  })

  const setup = combineHarnesses(setupClock)
  await using harness = await setup()

  expect(harness.getCurrentTime()).toEqual(new Date('2024-01-01T00:00:00.000Z'))
})

it('works with empty harness list', async () => {
  const setup = combineHarnesses()
  await using harness = await setup()

  expect(harness).toEqual(expect.objectContaining({}))
})
