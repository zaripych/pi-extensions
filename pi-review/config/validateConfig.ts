import { prettifyError, z } from 'zod'
import { defaultPrompts } from './defaults'

const RESERVED_TOOL_NAMES = ['reviewer-git', 'finish-review']

const modelChooseFromSchema = z.object({
  chooseFrom: z.array(z.string()).min(2),
})

const modelSchema = z.union([z.string(), modelChooseFromSchema], {
  error:
    'must be a model string (e.g. "provider/model-id") or { chooseFrom: ["model1", "model2", ...] }',
})

const reviewPromptsSchema = z.object({
  uncommitted: z
    .string()
    .min(1)
    .describe('Prompt for reviewing uncommitted changes.'),
  baseBranch: z
    .string()
    .min(1)
    .describe('Prompt for reviewing against a base branch.'),
  baseBranchFallback: z
    .string()
    .min(1)
    .describe('Prompt for reviewing against an upstream branch.'),
  commit: z.string().min(1).describe('Prompt for reviewing a specific commit.'),
  commitNoTitle: z
    .string()
    .min(1)
    .describe('Prompt for reviewing a commit without a title.'),
})

export const reviewConfigSchema = z.object({
  model: modelSchema
    .optional()
    .describe(
      'Model to use for review. A fixed "provider/model-id" string, or { chooseFrom: ["model1", "model2"] } to rotate. Omit to auto-select from available models.'
    ),
  tools: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
    .default(['read', 'grep', 'find', 'ls'])
    .describe('Tools available to the reviewer agent.')
    .superRefine((tools, ctx) => {
      const reserved = tools.find((t) => RESERVED_TOOL_NAMES.includes(t))
      if (reserved) {
        ctx.addIssue(
          `"${reserved}" is a reserved internal tool name and must not appear in config tools. It is added automatically.`
        )
      }
    }),
  systemPrompt: z
    .string()
    .min(1)
    .default('review-prompt.md')
    .describe(
      'Path to the system prompt file, relative to the config directory.'
    ),
  prompts: reviewPromptsSchema
    .partial()
    .optional()
    .describe(
      'Override individual review task prompts. Omit to use built-in defaults.'
    ),
  thresholds: z
    .object({
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .default(0)
        .describe(
          'Minimum confidence score (0.0–1.0) for a finding to be included.'
        ),
      maxPriority: z
        .int()
        .min(0)
        .max(3)
        .default(3)
        .describe(
          'Maximum priority level (0=blocker, 3=nice-to-have) for a finding to be included.'
        ),
    })
    .default({ minConfidence: 0, maxPriority: 3 })
    .describe('Thresholds for filtering review findings.'),
})

type RawReviewConfig = z.infer<typeof reviewConfigSchema>

export type ReviewConfig = Omit<RawReviewConfig, 'prompts'> & {
  prompts: z.infer<typeof reviewPromptsSchema>
}

export const defaultReviewConfig: ReviewConfig = validateConfig({})

function mergePrompts(
  prompts: RawReviewConfig['prompts']
): ReviewConfig['prompts'] {
  return {
    uncommitted: prompts?.uncommitted ?? defaultPrompts.uncommitted,
    baseBranch: prompts?.baseBranch ?? defaultPrompts.baseBranch,
    baseBranchFallback:
      prompts?.baseBranchFallback ?? defaultPrompts.baseBranchFallback,
    commit: prompts?.commit ?? defaultPrompts.commit,
    commitNoTitle: prompts?.commitNoTitle ?? defaultPrompts.commitNoTitle,
  }
}

export function validateConfig(raw: unknown): ReviewConfig {
  const result = reviewConfigSchema.safeParse(raw ?? {})
  if (!result.success) {
    throw new Error(`Invalid review config:\n${prettifyError(result.error)}`)
  }

  return {
    ...result.data,
    prompts: mergePrompts(result.data.prompts),
  }
}
