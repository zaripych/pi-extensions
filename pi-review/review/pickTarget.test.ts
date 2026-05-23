import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupPickTarget } from './pickTarget.harness'

const setup = combineHarnesses(setupPickTarget)

const noopSelect = async () => undefined
const noopInput = async () => undefined

describe('pickTarget', () => {
  it('returns uncommitted target when no args and no UI', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: false,
      select: noopSelect,
      input: noopInput,
    })

    expect(target).toEqual({ type: 'uncommitted' })
  })

  it('returns custom target when args are provided', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: 'check for regressions',
      hasUI: true,
      select: noopSelect,
      input: noopInput,
    })

    expect(target).toEqual({
      type: 'custom',
      instructions: 'check for regressions',
    })
  })

  it('returns uncommitted when selected from picker', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async () => 'Review uncommitted changes',
      input: noopInput,
    })

    expect(target).toEqual({ type: 'uncommitted' })
  })

  it('returns cancelled when user cancels the target picker', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async () => undefined,
      input: noopInput,
    })

    expect(target).toBe('cancelled')
  })

  it('runs branch picker when user selects base branch review', async () => {
    await using harness = await setup({
      listBranches: async () => ['main', 'develop', 'feature/foo'],
    })

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async (_title: string, options: string[]) => {
        if (options.includes('Review against a base branch')) {
          return 'Review against a base branch'
        }
        if (options.includes('main')) {
          return 'main'
        }
        throw new Error('Unexpected select options')
      },
      input: noopInput,
    })

    expect(target).toEqual({ type: 'baseBranch', branch: 'main' })
  })

  it('runs commit picker when user selects commit review', async () => {
    await using harness = await setup({
      listCommits: async () => [
        { sha: 'abc1234', title: 'fix: handle empty input' },
        { sha: 'def5678', title: 'feat: add login' },
      ],
    })

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async (_title: string, options: string[]) => {
        if (options.includes('Review a commit')) return 'Review a commit'
        if (options.includes('abc1234 fix: handle empty input')) {
          return 'abc1234 fix: handle empty input'
        }
        throw new Error('Unexpected select options')
      },
      input: noopInput,
    })

    expect(target).toEqual({
      type: 'commit',
      sha: 'abc1234',
      title: 'fix: handle empty input',
    })
  })

  it('shows text input when user selects custom review', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async () => 'Custom review instructions',
      input: async () => 'check error handling paths',
    })

    expect(target).toEqual({
      type: 'custom',
      instructions: 'check error handling paths',
    })
  })

  it('returns cancelled when user cancels branch picker', async () => {
    await using harness = await setup({
      listBranches: async () => ['main'],
    })

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async (_title: string, options: string[]) => {
        if (options.includes('Review against a base branch')) {
          return 'Review against a base branch'
        }
        if (options.includes('main')) {
          return undefined
        }
        throw new Error('Unexpected select options')
      },
      input: noopInput,
    })

    expect(target).toBe('cancelled')
  })

  it('returns cancelled when user cancels commit picker', async () => {
    await using harness = await setup({
      listCommits: async () => [{ sha: 'abc1234', title: 'some commit' }],
    })

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async (_title: string, options: string[]) => {
        if (options.includes('Review a commit')) return 'Review a commit'
        if (options.includes('abc1234 some commit')) {
          return undefined
        }
        throw new Error('Unexpected select options')
      },
      input: noopInput,
    })

    expect(target).toBe('cancelled')
  })

  it('returns cancelled when user cancels custom input', async () => {
    await using harness = await setup()

    const target = await harness.pickTarget({
      cwd: '/test/project',
      args: '',
      hasUI: true,
      select: async () => 'Custom review instructions',
      input: async () => undefined,
    })

    expect(target).toBe('cancelled')
  })
})
