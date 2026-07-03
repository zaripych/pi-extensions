import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupGitRepo } from '../testing/setupGitRepo'
import {
  getCurrentBranch,
  getDefaultBranch,
  listCommits,
  hasUncommittedChanges,
  listBranchesWithAuthors,
} from './commands'

describe('listBranchesWithAuthors', () => {
  it('lists local and remote branches with tip authors, newest tip first, excluding origin/HEAD', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({
      fileName: 'a.txt',
      authorName: 'Alice',
      date: '2026-01-01T10:00:00Z',
    })
    await repo.git('branch', 'old-branch')
    await repo.git('checkout', '-b', 'new-branch')
    await repo.commitFile({
      fileName: 'b.txt',
      authorName: 'Bob',
      date: '2026-03-01T10:00:00Z',
    })
    await repo.git('checkout', 'main')
    await repo.commitFile({
      fileName: 'c.txt',
      authorName: 'Carol',
      date: '2026-02-01T10:00:00Z',
    })
    await repo.git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main')
    await repo.git(
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main'
    )

    await expect(
      listBranchesWithAuthors({ cwd: repo.repoDir() })
    ).resolves.toEqual([
      { name: 'new-branch', author: 'Bob' },
      { name: 'main', author: 'Carol' },
      { name: 'origin/main', author: 'Carol' },
      { name: 'old-branch', author: 'Alice' },
    ])
  })
})

describe('getDefaultBranch', () => {
  it('returns the branch origin/HEAD points at', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })
    await repo.git('branch', '-m', 'master')
    await repo.git(
      'update-ref',
      'refs/remotes/origin/master',
      'refs/heads/master'
    )
    await repo.git(
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/master'
    )

    await expect(getDefaultBranch({ cwd: repo.repoDir() })).resolves.toBe(
      'master'
    )
  })

  it('returns undefined when origin/HEAD is not set', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })

    await expect(
      getDefaultBranch({ cwd: repo.repoDir() })
    ).resolves.toBeUndefined()
  })
})

describe('getCurrentBranch', () => {
  it('returns the checked-out branch name', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })
    await repo.git('checkout', '-b', 'feature/login')

    await expect(getCurrentBranch({ cwd: repo.repoDir() })).resolves.toBe(
      'feature/login'
    )
  })

  it('returns the branch name in a repo with no commits', async () => {
    await using repo = await setupGitRepo()

    await expect(getCurrentBranch({ cwd: repo.repoDir() })).resolves.toBe(
      'main'
    )
  })

  it('returns HEAD when detached', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })
    await repo.git('checkout', '--detach')

    await expect(getCurrentBranch({ cwd: repo.repoDir() })).resolves.toBe(
      'HEAD'
    )
  })
})

describe('listCommits', () => {
  it('returns an empty list in a repo with no commits', async () => {
    await using repo = await setupGitRepo()

    await expect(listCommits({ cwd: repo.repoDir() })).resolves.toEqual([])
  })
})

describe('hasUncommittedChanges', () => {
  it('returns false for a clean working tree', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })

    await expect(hasUncommittedChanges({ cwd: repo.repoDir() })).resolves.toBe(
      false
    )
  })

  it('returns true when an untracked file exists', async () => {
    await using repo = await setupGitRepo()
    await repo.commitFile({ fileName: 'a.txt' })
    await writeFile(join(repo.repoDir(), 'untracked.txt'), 'new')

    await expect(hasUncommittedChanges({ cwd: repo.repoDir() })).resolves.toBe(
      true
    )
  })
})
