import { loadConfig } from '../config/loadConfig'
import { formatReviewForContext } from '../review-output/formatReviewForContext'
import type { ReviewOutput } from '../review-output/reviewOutputSchema'
import { runReviewSession } from '../review-session/runReviewSession'
import { pickTarget } from './pickTarget'
import { renderTaskPrompt } from './renderTaskPrompt'
import { resolveTarget } from './resolveTarget'
import { selectReviewModel } from './selectReviewModel'

const defaultDeps = {
  pickTarget,
  loadConfig,
  resolveTarget,
  runReviewSession,
}

export async function reviewCommand(
  params: {
    args: string
    cwd: string
    currentModelId: string | undefined
    availableModelIds: string[]
    hasUI: boolean
    select: (title: string, options: string[]) => Promise<string | undefined>
    input: (title: string, placeholder?: string) => Promise<string | undefined>
    notify: (message: string, level: 'info' | 'warning' | 'error') => void
    sendMessage: (message: {
      customType: string
      content: string
      display: boolean
      details: ReviewOutput & { modelId: string }
    }) => void
  },
  deps = defaultDeps
): Promise<
  | { output: ReviewOutput; modelId: string }
  | { cancelled: true }
  | { sessionError: string }
> {
  const { config, configError } = await deps.loadConfig()
  if (configError) {
    params.notify(
      `Using default review config due to errors:\n${configError}`,
      'warning'
    )
  }

  const target = await deps.pickTarget(params)
  if (target === 'cancelled') {
    return { cancelled: true }
  }

  const reviewTarget = await deps.resolveTarget({ target, cwd: params.cwd })

  const taskPrompt = renderTaskPrompt({
    target: reviewTarget,
    prompts: config.prompts,
  })

  const modelId =
    typeof config.model === 'string'
      ? config.model
      : selectReviewModel({
          modelConfig:
            typeof config.model === 'object' ? config.model : undefined,
          currentModelId: params.currentModelId,
          availableModelIds: params.availableModelIds,
        })

  const { output, sessionError } = await deps.runReviewSession({
    config,
    cwd: params.cwd,
    modelId,
    taskPrompt,
  })

  if (!output) {
    const error = sessionError ?? 'Reviewer produced no structured output.'
    params.notify(`Review failed: ${error}`, 'error')
    return { sessionError: error }
  }

  if (sessionError) {
    params.notify(`Review session error: ${sessionError}`, 'error')
  }

  params.sendMessage({
    customType: 'review',
    content: formatReviewForContext({ output, cwd: params.cwd, modelId }),
    display: true,
    details: { ...output, modelId },
  })

  return { output, modelId }
}

reviewCommand.defaultDeps = defaultDeps
