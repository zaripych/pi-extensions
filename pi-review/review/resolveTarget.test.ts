import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupResolveTarget } from './resolveTarget.harness'

const setup = combineHarnesses(setupResolveTarget)
const cwd = '/test/project'

describe('resolveTarget', () => {
  it('returns uncommitted target unchanged', async () => {
    await using harness = await setup()

    const target = await harness.resolveTarget({
      target: { type: 'uncommitted' },
      cwd,
    })

    expect(target).toEqual({ type: 'uncommitted' })
  })

  it('returns custom instructions unchanged', async () => {
    await using harness = await setup()

    const target = await harness.resolveTarget({
      target: { type: 'custom', instructions: 'check error handling paths' },
      cwd,
    })

    expect(target).toEqual({
      type: 'custom',
      instructions: 'check error handling paths',
    })
  })

  it('returns commit sha and title unchanged', async () => {
    await using harness = await setup()

    const target = await harness.resolveTarget({
      target: {
        type: 'commit',
        sha: 'abc1234',
        title: 'fix: handle empty input',
      },
      cwd,
    })

    expect(target).toEqual({
      type: 'commit',
      sha: 'abc1234',
      title: 'fix: handle empty input',
    })
  })

  it('returns base branch target with its merge base', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => 'def5678',
    })

    const target = await harness.resolveTarget({
      target: { type: 'baseBranch', branch: 'main' },
      cwd,
    })

    expect(target).toEqual({
      type: 'baseBranch',
      baseBranch: 'main',
      mergeBaseSha: 'def5678',
    })
  })

  it('falls back to upstream branch when direct merge base resolution fails', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => {
        throw new Error('no direct merge base')
      },
      getMergeBaseForUpstream: async () => 'fedcba9',
      getUpstreamBranch: async () => 'origin/main',
    })

    const target = await harness.resolveTarget({
      target: { type: 'baseBranch', branch: 'main' },
      cwd,
    })

    expect(target).toEqual({
      type: 'baseBranchFallback',
      branch: 'main',
      upstreamBranch: 'origin/main',
      mergeBaseSha: 'fedcba9',
    })
  })

  it('reports a clear error when fallback upstream resolution fails', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => {
        throw new Error('no direct merge base')
      },
      getUpstreamBranch: async () => {
        throw new Error('no upstream')
      },
    })

    await expect(
      harness.resolveTarget({
        target: { type: 'baseBranch', branch: 'main' },
        cwd,
      })
    ).rejects.toThrow('Unable to resolve upstream branch for main.')
  })

  it('reports a clear error when fallback merge base resolution fails', async () => {
    await using harness = await setup({
      getMergeBaseForBranch: async () => {
        throw new Error('no direct merge base')
      },
      getMergeBaseForUpstream: async () => {
        throw new Error('no merge base')
      },
      getUpstreamBranch: async () => 'origin/main',
    })

    await expect(
      harness.resolveTarget({
        target: { type: 'baseBranch', branch: 'main' },
        cwd,
      })
    ).rejects.toThrow(
      'Unable to resolve merge base for upstream branch origin/main.'
    )
  })
})
