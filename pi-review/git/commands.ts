import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { spawnToFile } from './spawnToFile'

const execFileAsync = promisify(execFile)

// oxlint-disable-next-line no-control-regex -- not an input
const controlCharacterPattern = /[\u0000-\u001F\u007F]/u
const hexShaPattern = /^[0-9a-fA-F]{7,40}$/

function assertSafeRef(ref: string): void {
  if (
    ref.trim() === '' ||
    ref.startsWith('-') ||
    controlCharacterPattern.test(ref)
  ) {
    throw new Error('Invalid git ref.')
  }
}

function assertSafeSha(sha: string): void {
  if (!hexShaPattern.test(sha)) {
    throw new Error(`Invalid sha: must be 7-40 hex characters, got "${sha}".`)
  }
}

function assertSafePath(p: string): void {
  if (
    p === '' ||
    p === '.' ||
    p.startsWith('/') ||
    p.startsWith('-') ||
    p.includes('..') ||
    p.includes('//') ||
    controlCharacterPattern.test(p)
  ) {
    throw new Error(`Invalid path: "${p}".`)
  }
}

// --- Shared commands (used by both parent process and reviewer subprocess) ---

export async function listBranches(params: {
  cwd?: string
}): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['branch', '--format=%(refname:short)'],
    { cwd: params.cwd }
  )
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export async function getMergeBase(params: {
  ref: string
  cwd?: string
}): Promise<string> {
  assertSafeRef(params.ref)
  const { stdout } = await execFileAsync(
    'git',
    ['merge-base', '--end-of-options', 'HEAD', params.ref],
    { cwd: params.cwd }
  )
  return stdout.trim()
}

export async function getUpstreamBranch(params: {
  branch: string
  cwd?: string
}): Promise<string> {
  assertSafeRef(params.branch)
  const { stdout } = await execFileAsync(
    'git',
    [
      'rev-parse',
      '--abbrev-ref',
      '--end-of-options',
      `${params.branch}@{upstream}`,
    ],
    { cwd: params.cwd }
  )
  return stdout.trim()
}

export async function listCommits(params: {
  cwd?: string
}): Promise<{ sha: string; title: string }[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['log', '--oneline', '-n', '20', '--format=%h %s'],
    { cwd: params.cwd }
  )
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const spaceIndex = line.indexOf(' ')
      return {
        sha: line.slice(0, spaceIndex),
        title: line.slice(spaceIndex + 1),
      }
    })
}

// --- Reviewer subprocess commands ---
// Large-output commands stream stdout to a temp file and return the file path.

export async function gitStatusShort(params: {
  cwd?: string
}): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--short'], {
    cwd: params.cwd,
  })
  return stdout
}

export async function gitDiff(params: {
  base?: string
  paths?: string[]
  cwd?: string
}): Promise<string> {
  const args = ['diff', '--end-of-options']
  if (params.base !== undefined) {
    assertSafeRef(params.base)
    args.push(params.base)
  }
  args.push('--')
  if (params.paths) {
    for (const p of params.paths) assertSafePath(p)
    args.push(...params.paths)
  }
  return spawnToFile({ command: 'git', args, cwd: params.cwd })
}

export async function gitDiffCached(params: {
  paths?: string[]
  cwd?: string
}): Promise<string> {
  const args = ['diff', '--cached', '--end-of-options', '--']
  if (params.paths) {
    for (const p of params.paths) assertSafePath(p)
    args.push(...params.paths)
  }
  return spawnToFile({ command: 'git', args, cwd: params.cwd })
}

export async function gitShow(params: {
  sha: string
  cwd?: string
}): Promise<string> {
  assertSafeSha(params.sha)
  return spawnToFile({
    command: 'git',
    args: ['show', '--stat', '--patch', '--end-of-options', params.sha],
    cwd: params.cwd,
  })
}

export async function gitLog(params: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync('git', ['log', '--oneline', '-100'], {
    cwd: params.cwd,
  })
  return stdout
}
