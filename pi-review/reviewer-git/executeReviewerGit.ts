import {
  getMergeBase,
  getUpstreamBranch,
  gitDiff,
  gitDiffCached,
  gitLog,
  gitShow,
  gitStatusShort,
  listBranches,
} from '../git/commands'

export type GitOutput = string | { filePath: string }

const defaultDeps = {
  gitStatusShort,
  gitDiff,
  gitDiffCached,
  gitShow,
  gitLog,
  listBranches,
  getMergeBase,
  getUpstreamBranch,
}

export async function executeReviewerGit(
  params: {
    action: string
    base?: string
    sha?: string
    branch?: string
    paths?: string[]
    cwd?: string
  },
  deps = defaultDeps
): Promise<GitOutput> {
  const { cwd } = params
  switch (params.action) {
    case 'statusShort':
      return deps.gitStatusShort({ cwd })
    case 'diff': {
      const diffParams: { base?: string; paths?: string[]; cwd?: string } = {
        cwd,
      }
      if (params.base !== undefined) diffParams.base = params.base
      if (params.paths !== undefined) diffParams.paths = params.paths
      const filePath = await deps.gitDiff(diffParams)
      return { filePath }
    }
    case 'diffCached': {
      const cachedParams: { paths?: string[]; cwd?: string } = { cwd }
      if (params.paths !== undefined) cachedParams.paths = params.paths
      const filePath = await deps.gitDiffCached(cachedParams)
      return { filePath }
    }
    case 'show': {
      if (!params.sha) throw new Error('show action requires sha')
      const filePath = await deps.gitShow({ sha: params.sha, cwd })
      return { filePath }
    }
    case 'log':
      return deps.gitLog({ cwd })
    case 'branches': {
      const branches = await deps.listBranches({ cwd })
      return branches.join('\n')
    }
    case 'mergeBase': {
      if (!params.branch) throw new Error('mergeBase action requires branch')
      return deps.getMergeBase({ ref: params.branch, cwd })
    }
    case 'revParseUpstream': {
      if (!params.branch)
        throw new Error('revParseUpstream action requires branch')
      return deps.getUpstreamBranch({ branch: params.branch, cwd })
    }
    default:
      throw new Error(`Unsupported reviewer-git action: ${params.action}`)
  }
}

executeReviewerGit.defaultDeps = defaultDeps
