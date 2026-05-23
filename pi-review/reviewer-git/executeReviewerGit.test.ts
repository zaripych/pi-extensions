import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupExecuteReviewerGit } from './executeReviewerGit.harness'

const setup = combineHarnesses(setupExecuteReviewerGit)

describe('executeReviewerGit', () => {
  it('dispatches statusShort to gitStatusShort', async () => {
    await using harness = await setup({
      gitStatusShort: async () => 'M  src/index.ts',
    })

    const result = await harness.executeReviewerGit({ action: 'statusShort' })

    expect(result).toBe('M  src/index.ts')
  })

  it('dispatches diff with base and paths and returns filePath', async () => {
    await using harness = await setup()

    const result = await harness.executeReviewerGit({
      action: 'diff',
      base: 'abc1234',
      paths: ['src/a.ts'],
      cwd: '/some/project',
    })

    expect(result).toEqual({ filePath: expect.any(String) })
    expect(harness.gitDiff).toHaveBeenCalledWith({
      base: 'abc1234',
      paths: ['src/a.ts'],
      cwd: '/some/project',
    })
  })

  it('dispatches diffCached with paths and returns filePath', async () => {
    await using harness = await setup()

    const result = await harness.executeReviewerGit({
      action: 'diffCached',
      paths: ['src/b.ts'],
    })

    expect(result).toEqual({ filePath: expect.any(String) })
    expect(harness.gitDiffCached).toHaveBeenCalledWith({
      paths: ['src/b.ts'],
    })
  })

  it('dispatches show with sha and returns filePath', async () => {
    await using harness = await setup()

    const result = await harness.executeReviewerGit({
      action: 'show',
      sha: 'abc1234',
    })

    expect(result).toEqual({ filePath: expect.any(String) })
    expect(harness.gitShow).toHaveBeenCalledWith({ sha: 'abc1234' })
  })

  it('dispatches log', async () => {
    await using harness = await setup({
      gitLog: async () => 'log output',
    })

    const result = await harness.executeReviewerGit({ action: 'log' })

    expect(result).toBe('log output')
  })

  it('dispatches branches', async () => {
    await using harness = await setup({
      listBranches: async () => ['main', 'develop'],
    })

    const result = await harness.executeReviewerGit({ action: 'branches' })

    expect(result).toBe('main\ndevelop')
  })

  it('dispatches mergeBase with branch', async () => {
    await using harness = await setup({
      getMergeBase: async () => 'abc1234',
    })

    const result = await harness.executeReviewerGit({
      action: 'mergeBase',
      branch: 'main',
    })

    expect(result).toBe('abc1234')
    expect(harness.getMergeBase).toHaveBeenCalledWith({ ref: 'main' })
  })

  it('dispatches revParseUpstream with branch', async () => {
    await using harness = await setup({
      getUpstreamBranch: async () => 'origin/main',
    })

    const result = await harness.executeReviewerGit({
      action: 'revParseUpstream',
      branch: 'main',
    })

    expect(result).toBe('origin/main')
    expect(harness.getUpstreamBranch).toHaveBeenCalledWith({ branch: 'main' })
  })

  it('rejects unsupported actions', async () => {
    await using harness = await setup()

    await expect(
      harness.executeReviewerGit({ action: 'checkout' })
    ).rejects.toThrow('Unsupported reviewer-git action')
  })
})
