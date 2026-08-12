import { loadConfig } from '../config/loadConfig'
import { formatReviewForContext } from '../review-output/formatReviewForContext'
import type { ReviewOutput } from '../review-output/reviewOutputSchema'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { runReviewSession } from '../review-session/runReviewSession'
import { collectReviewParams } from './collectReviewParams'
import type { ReviewFormData } from './prepareReviewForm'
import type { ReviewFormResult } from './ReviewForm'
import { renderTargetPrompt } from './renderTargetPrompt'
import { resolveTarget } from './resolveTarget'
import { selectReviewModel } from './selectReviewModel'

const defaultDeps = {
  collectReviewParams,
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
  showReviewForm: (
    form: ReviewFormData
  ) => Promise<ReviewFormResult | 'fetch' | undefined>
  notify: (message: string, level: 'info' | 'warning' | 'error') => void
  createModelRuntime: (modelId: string) => Promise<{
    model: Model<Api> | undefined
    modelRuntime: ModelRuntime
  }>
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
  const { config, configError, warnings } = await deps.loadConfig()
  for (const warning of warnings) {
    params.notify(warning, 'warning')
  }
  if (configError) {
    params.notify(
      `Using default review config due to errors:\n${configError}`,
      'warning'
    )
  }

  const modelConfig =
    typeof config.model === 'string'
      ? { chooseFrom: [config.model] }
      : config.model

  const reviewParams = await deps.collectReviewParams({
    args: params.args,
    cwd: params.cwd,
    hasUI: params.hasUI,
    currentModelId: params.currentModelId,
    availableModelIds: params.availableModelIds,
    modelConfig,
    reviewInstructionsGlob: config.reviewInstructionsGlob,
    notify: params.notify,
    runWithCancellableLoader: params.runWithCancellableLoader,
    showReviewForm: params.showReviewForm,
  })
  if (reviewParams === 'cancelled') {
    return { cancelled: true }
  }

  const reviewTarget = await deps.resolveTarget({
    target: reviewParams.target,
    cwd: params.cwd,
  })

  const targetPrompt = renderTargetPrompt(reviewTarget)
  const selectedInstructions =
    reviewParams.reviewInstructions?.content ??
    config.correctnessInstructionsContent
  const instructionsLabel =
    reviewParams.reviewInstructions?.path ?? 'Correctness'
  params.notify(`Using review instructions: ${instructionsLabel}`, 'info')
  const taskPrompt = `${targetPrompt}\n\n${selectedInstructions}`

  const modelId =
    reviewParams.modelId ??
    selectReviewModel({
      modelConfig,
      currentModelId: params.currentModelId,
      availableModelIds: params.availableModelIds,
    })

  const runSession = (runArgs: { signal?: AbortSignal }) =>
    deps.runReviewSession({
      config,
      cwd: params.cwd,
      modelId,
      createModelRuntime: params.createModelRuntime,
      taskPrompt,
      includeAgentsMd: reviewParams.includeAgentsMd ?? false,
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
