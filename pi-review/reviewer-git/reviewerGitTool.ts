import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { executeReviewerGit } from './executeReviewerGit'
import { readOutputFile } from './readOutputFile'

const ReviewerGitParams = Type.Object({
  action: StringEnum(
    [
      'statusShort',
      'diff',
      'diffCached',
      'show',
      'log',
      'branches',
      'mergeBase',
      'revParseUpstream',
    ] as const,
    { description: 'Git action to perform.' }
  ),
  base: Type.Optional(
    Type.String({ description: 'Base ref for diff (e.g. merge-base sha).' })
  ),
  sha: Type.Optional(
    Type.String({ description: 'Commit sha for show action.' })
  ),
  branch: Type.Optional(
    Type.String({
      description: 'Branch name for mergeBase/revParseUpstream actions.',
    })
  ),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Restrict diff/diffCached to these relative paths.',
    })
  ),
})

export const reviewerGitTool = defineTool({
  name: 'reviewer-git',
  label: 'Reviewer Git',
  description:
    'Read-only git inspection for code review. Use the action parameter to select the git operation.',
  parameters: ReviewerGitParams,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const output = await executeReviewerGit({ ...params, cwd: ctx.cwd })

    if (typeof output === 'string') {
      return {
        content: [{ type: 'text', text: output }],
        details: undefined,
      }
    }

    const { content, fullOutputPath } = await readOutputFile({
      filePath: output.filePath,
    })
    const suffix = fullOutputPath
      ? `\n[Output truncated. Full output: ${fullOutputPath} — use the read tool with offset/limit to see more.]`
      : ''

    return {
      content: [{ type: 'text', text: content + suffix }],
      details: undefined,
    }
  },
})
