import { loadConfig } from '../config/loadConfig'
import { formatReviewForContext } from '../review-output/formatReviewForContext'
import type { ReviewOutput } from '../review-output/reviewOutputSchema'
import { runReviewSession } from '../review-session/runReviewSession'
import { pickTarget } from './pickTarget'
import type { ReviewFormData } from './prepareReviewForm'
import type { ReviewFormResult } from './ReviewForm'
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
  showReviewForm: (
    form: ReviewFormData
  ) => Promise<ReviewFormResult | 'fetch' | undefined>
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

  const modelConfig =
    typeof config.model === 'string'
      ? { chooseFrom: [config.model] }
      : config.model

  const picked = await deps.pickTarget({
    args: params.args,
    cwd: params.cwd,
    hasUI: params.hasUI,
    currentModelId: params.currentModelId,
    availableModelIds: params.availableModelIds,
    modelConfig,
    notify: params.notify,
    runWithCancellableLoader: params.runWithCancellableLoader,
    showReviewForm: params.showReviewForm,
  })
  if (picked === 'cancelled') {
    return { cancelled: true }
  }

  const reviewTarget = await deps.resolveTarget({
    target: picked.target,
    cwd: params.cwd,
  })

  const taskPrompt = renderTaskPrompt(reviewTarget)

  const modelId =
    picked.modelId ??
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
      taskPrompt,
      includeAgents: picked.includeAgents ?? false,
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
