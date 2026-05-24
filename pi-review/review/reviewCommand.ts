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

type ReviewCommandParams = {
  args: string
  cwd: string
  currentModelId: string | undefined
  availableModelIds: string[]
  hasUI: boolean
  select: (title: string, options: string[]) => Promise<string | undefined>
  input: (title: string, placeholder?: string) => Promise<string | undefined>
  notify: (message: string, level: 'info' | 'warning' | 'error') => void
  runWithCancellableLoader: <T>(args: {
    description: string
    run: (runArgs: { signal: AbortSignal }) => Promise<T>
  }) => Promise<T>
  sendMessage: (message: {
    customType: string
    content: string
    display: boolean
    details: ReviewOutput & { modelId: string }
  }) => void
}

type ReviewCommandResult =
  | { output: ReviewOutput; modelId: string }
  | { cancelled: true }
  | { error: string }

export async function reviewCommand(
  params: ReviewCommandParams,
  deps = defaultDeps
): Promise<ReviewCommandResult> {
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

  const runSession = (runArgs: { signal?: AbortSignal }) =>
    deps.runReviewSession({
      config,
      cwd: params.cwd,
      modelId,
      taskPrompt,
      signal: runArgs.signal,
    })

  const reviewSessionResult = params.hasUI
    ? await params.runWithCancellableLoader({
        description: `Running review with ${modelId}...`,
        run: runSession,
      })
    : await runSession({})

  if ('cancelled' in reviewSessionResult) {
    return { cancelled: true }
  }

  if ('error' in reviewSessionResult) {
    params.notify(`Review failed: ${reviewSessionResult.error}`, 'error')
    return { error: reviewSessionResult.error }
  }

  const { output } = reviewSessionResult
  params.sendMessage({
    customType: 'review',
    content: formatReviewForContext({ output, cwd: params.cwd, modelId }),
    display: true,
    details: { ...output, modelId },
  })

  return { output, modelId }
}

reviewCommand.defaultDeps = defaultDeps
