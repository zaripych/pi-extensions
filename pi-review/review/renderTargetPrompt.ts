import dedent from 'dedent'

export type ReviewTarget =
  | { type: 'uncommitted' }
  | {
      type: 'baseBranch'
      baseBranch: string
      upstreamBranch?: string
      mergeBaseSha: string
    }
  | { type: 'commit'; sha: string; title?: string }
  | { type: 'freeform'; instructions: string }

function uncommittedTargetPrompt(): string {
  return dedent`
    Review the current code changes, including staged, unstaged, and untracked
    files. Start with the \`reviewer-git\` tool using
    \`{ action: "statusShort" }\`, inspect unstaged changes with
    \`{ action: "diff" }\`, inspect staged changes with
    \`{ action: "diffCached" }\`, and read relevant untracked files reported by
    status.
  `
}

function baseBranchTargetPrompt(params: {
  baseBranch: string
  upstreamBranch?: string
  mergeBaseSha: string
}): string {
  const against =
    params.upstreamBranch === undefined
      ? `the base branch '${params.baseBranch}'`
      : `'${params.baseBranch}' via its upstream '${params.upstreamBranch}'`
  const diffBranch = params.upstreamBranch ?? params.baseBranch
  return dedent`
    Review the code changes against ${against}. The merge base commit for this
    comparison is ${params.mergeBaseSha}. Use the \`reviewer-git\` tool with
    \`{ action: "diff", base: "${params.mergeBaseSha}" }\` to inspect the
    changes relative to ${diffBranch}.
  `
}

function commitTargetPrompt(params: { sha: string; title?: string }): string {
  const commit =
    params.title === undefined
      ? `commit ${params.sha}`
      : `commit ${params.sha} ("${params.title}")`
  return dedent`
    Review the code changes introduced by ${commit}. Use the \`reviewer-git\`
    tool with \`{ action: "show", sha: "${params.sha}" }\` and read surrounding
    files as needed.
  `
}

export function renderTargetPrompt(target: ReviewTarget): string {
  switch (target.type) {
    case 'uncommitted':
      return uncommittedTargetPrompt()
    case 'baseBranch':
      return baseBranchTargetPrompt(target)
    case 'commit':
      return commitTargetPrompt(target)
    case 'freeform':
      return target.instructions
  }
}
