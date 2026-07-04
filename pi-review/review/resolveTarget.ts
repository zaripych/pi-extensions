import { getMergeBase, getUpstreamBranch } from '../git/commands'
import type { TargetSelection } from './pickTarget'
import type { ReviewTarget } from './renderTaskPrompt'

const defaultDeps = {
  getMergeBaseForBranch: getMergeBase,
  getMergeBaseForUpstream: getMergeBase,
  getUpstreamBranch,
}

export async function resolveTarget(
  params: { target: TargetSelection; cwd: string },
  deps = defaultDeps
): Promise<ReviewTarget> {
  const { target, cwd } = params
  switch (target.type) {
    case 'uncommitted':
      return { type: 'uncommitted' }
    case 'custom':
      return { type: 'custom', instructions: target.instructions }
    case 'commit':
      return { type: 'commit', sha: target.sha, title: target.title }
    case 'baseBranch':
      try {
        return {
          type: 'baseBranch',
          baseBranch: target.branch,
          mergeBaseSha: await deps.getMergeBaseForBranch({
            ref: target.branch,
            cwd,
          }),
        }
      } catch {
        let upstreamBranch: string
        try {
          upstreamBranch = await deps.getUpstreamBranch({
            branch: target.branch,
            cwd,
          })
        } catch (error) {
          throw new Error(
            `Unable to resolve upstream branch for ${target.branch}.`,
            { cause: error }
          )
        }

        let mergeBaseSha: string
        try {
          mergeBaseSha = await deps.getMergeBaseForUpstream({
            ref: upstreamBranch,
            cwd,
          })
        } catch (error) {
          throw new Error(
            `Unable to resolve merge base for upstream branch ${upstreamBranch}.`,
            { cause: error }
          )
        }

        return {
          type: 'baseBranch',
          baseBranch: target.branch,
          upstreamBranch,
          mergeBaseSha,
        }
      }
  }
}

resolveTarget.defaultDeps = defaultDeps
