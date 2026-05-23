import { describe, expect, it } from 'vitest'
import {
  getMergeBase,
  getUpstreamBranch,
  gitDiff,
  gitDiffCached,
  gitShow,
} from './commands'

describe('reviewerGitCommands', () => {
  describe('ref validation', () => {
    it.each(['--output=/tmp/pwned', '-c', '', 'bad\u0000ref', 'bad\u001Fref'])(
      'gitDiff rejects unsafe base ref %j',
      async (base) => {
        await expect(gitDiff({ base })).rejects.toThrow('Invalid git ref')
      }
    )

    it.each(['--output=/tmp/pwned', '-c', '', 'bad\u0000ref', 'bad\u001Fref'])(
      'getMergeBase rejects unsafe ref %j',
      async (ref) => {
        await expect(getMergeBase({ ref })).rejects.toThrow('Invalid git ref')
      }
    )

    it.each(['--output=/tmp/pwned', '-c', '', 'bad\u0000ref', 'bad\u001Fref'])(
      'getUpstreamBranch rejects unsafe branch ref %j',
      async (branch) => {
        await expect(getUpstreamBranch({ branch })).rejects.toThrow(
          'Invalid git ref'
        )
      }
    )
  })

  describe('sha validation', () => {
    it.each([
      'not-hex',
      '--output=/tmp/pwned',
      '',
      'abc12g',
      'abc12 def',
      'abc\u0000def',
    ])('gitShow rejects non-hex sha %j', async (sha) => {
      await expect(gitShow({ sha })).rejects.toThrow('Invalid sha')
    })
  })

  describe('path validation', () => {
    it.each(['/etc/passwd', '/absolute/path.ts'])(
      'gitDiff rejects absolute path %j',
      async (p) => {
        await expect(gitDiff({ paths: [p] })).rejects.toThrow('Invalid path')
      }
    )

    it.each([
      '../etc/passwd',
      'src/../../../etc/passwd',
      'src/foo/../../bar/../../../etc',
    ])('gitDiff rejects path traversal %j', async (p) => {
      await expect(gitDiff({ paths: [p] })).rejects.toThrow('Invalid path')
    })

    it.each(['-output=/tmp/pwned', '--output=/tmp/pwned'])(
      'gitDiff rejects path starting with dash %j',
      async (p) => {
        await expect(gitDiff({ paths: [p] })).rejects.toThrow('Invalid path')
      }
    )

    it('gitDiff rejects path with empty segment', async () => {
      await expect(gitDiff({ paths: ['src//a.ts'] })).rejects.toThrow(
        'Invalid path'
      )
    })

    it('gitDiffCached rejects dot segment path', async () => {
      await expect(gitDiffCached({ paths: ['.'] })).rejects.toThrow(
        'Invalid path'
      )
    })

    it('gitDiff rejects path containing control characters', async () => {
      await expect(
        gitDiff({ paths: ['src/bad\u0000file.ts'] })
      ).rejects.toThrow('Invalid path')
    })
  })
})
