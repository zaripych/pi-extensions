import type { ReviewConfig } from '../config/validateConfig'

export type ReviewTarget =
  | { type: 'uncommitted' }
  | { type: 'baseBranch'; baseBranch: string; mergeBaseSha: string }
  | {
      type: 'baseBranchFallback'
      branch: string
      upstreamBranch: string
      mergeBaseSha: string
    }
  | { type: 'commit'; sha: string; title?: string }
  | { type: 'custom'; instructions: string }

export function renderTaskPrompt(params: {
  target: ReviewTarget
  prompts: ReviewConfig['prompts']
}): string {
  const { target, prompts } = params

  switch (target.type) {
    case 'uncommitted':
      return prompts.uncommitted
    case 'baseBranch':
      return prompts.baseBranch
        .replaceAll('{{base_branch}}', target.baseBranch)
        .replaceAll('{{merge_base_sha}}', target.mergeBaseSha)
    case 'baseBranchFallback':
      return prompts.baseBranchFallback
        .replaceAll('{{branch}}', target.branch)
        .replaceAll('{{upstream_branch}}', target.upstreamBranch)
        .replaceAll('{{merge_base_sha}}', target.mergeBaseSha)
    case 'commit':
      if (target.title !== undefined) {
        return prompts.commit
          .replaceAll('{{sha}}', target.sha)
          .replaceAll('{{title}}', target.title)
      }
      return prompts.commitNoTitle.replaceAll('{{sha}}', target.sha)
    case 'custom':
      return target.instructions
  }
}
