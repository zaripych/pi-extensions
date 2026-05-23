import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dedent from 'dedent'

type Markdown = {
  (literals: string): string
  (strings: TemplateStringsArray, ...values: unknown[]): string
}

const markdown: Markdown = dedent

const reviewPromptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'review-prompt.md'
)

export async function getDefaultSystemPromptContent(): Promise<string> {
  return readFile(reviewPromptPath, 'utf-8')
}

export const defaultPrompts = {
  uncommitted: markdown`
    Review the current code changes, including staged, unstaged, and untracked
    files. Start with the \`reviewer-git\` tool using
    \`{ action: "statusShort" }\`, inspect unstaged changes with
    \`{ action: "diff" }\`, inspect staged changes with
    \`{ action: "diffCached" }\`, and read relevant untracked files reported by
    status. Provide prioritized findings.
  `,
  baseBranch: markdown`
    Review the code changes against the base branch '{{base_branch}}'. The merge
    base commit for this comparison is {{merge_base_sha}}. Use the
    \`reviewer-git\` tool with
    \`{ action: "diff", base: "{{merge_base_sha}}" }\` to inspect the changes
    relative to {{base_branch}}. Provide prioritized, actionable findings.
  `,
  baseBranchFallback: markdown`
    Review the code changes against '{{branch}}' via its upstream
    '{{upstream_branch}}'. The merge base commit for this comparison is
    {{merge_base_sha}}. Use the \`reviewer-git\` tool with
    \`{ action: "diff", base: "{{merge_base_sha}}" }\` to inspect the changes
    relative to {{upstream_branch}}. Provide prioritized, actionable findings.
  `,
  commit: markdown`
    Review the code changes introduced by commit {{sha}} ("{{title}}"). Use the
    \`reviewer-git\` tool with \`{ action: "show", sha: "{{sha}}" }\` and read
    surrounding files as needed. Provide prioritized, actionable findings.
  `,
  commitNoTitle: markdown`
    Review the code changes introduced by commit {{sha}}. Use the
    \`reviewer-git\` tool with \`{ action: "show", sha: "{{sha}}" }\` and read
    surrounding files as needed. Provide prioritized, actionable findings.
  `,
}
