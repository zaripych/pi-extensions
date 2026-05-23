import { listBranches, listCommits } from '../git/commands'

export type TargetSelection =
  | { type: 'uncommitted' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string }
  | { type: 'custom'; instructions: string }

const defaultDeps = {
  listBranches,
  listCommits,
}

export interface PickTargetParams {
  args: string
  cwd: string
  hasUI: boolean
  select: (title: string, options: string[]) => Promise<string | undefined>
  input: (title: string, placeholder?: string) => Promise<string | undefined>
}

const TARGET_OPTIONS = [
  'Review uncommitted changes',
  'Review against a base branch',
  'Review a commit',
  'Custom review instructions',
] as const

export async function pickTarget(
  params: PickTargetParams,
  deps = defaultDeps
): Promise<TargetSelection | 'cancelled'> {
  if (params.args !== '') {
    return { type: 'custom', instructions: params.args }
  }

  if (!params.hasUI) {
    return { type: 'uncommitted' }
  }

  const choice = await params.select('Review target', [...TARGET_OPTIONS])

  switch (choice) {
    case 'Review uncommitted changes':
      return { type: 'uncommitted' }
    case 'Review against a base branch': {
      const branches = await deps.listBranches({ cwd: params.cwd })
      const branch = await params.select('Select branch', branches)
      if (!branch) return 'cancelled'
      return { type: 'baseBranch', branch }
    }
    case 'Review a commit': {
      const commits = await deps.listCommits({ cwd: params.cwd })
      const labels = commits.map((c) => `${c.sha} ${c.title}`)
      const selected = await params.select('Select commit', labels)
      if (!selected) return 'cancelled'
      const commit = commits.find((c) => `${c.sha} ${c.title}` === selected)
      if (!commit) return 'cancelled'
      return { type: 'commit', sha: commit.sha, title: commit.title }
    }
    case 'Custom review instructions': {
      const instructions = await params.input(
        'Review instructions',
        'Describe what to review...'
      )
      if (!instructions) return 'cancelled'
      return { type: 'custom', instructions }
    }
    default:
      return 'cancelled'
  }
}

pickTarget.defaultDeps = defaultDeps
