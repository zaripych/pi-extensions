import {
  prepareReviewForm,
  type ReviewFormData,
  type ReviewInstructionFile,
} from './prepareReviewForm'
import type { ReviewFormResult } from './ReviewForm'
import { fetchOrigin } from '../git/commands'

export type TargetSelection =
  | { type: 'uncommitted' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string }
  | { type: 'freeform'; instructions: string }

const defaultDeps = {
  prepareReviewForm,
  fetchOrigin,
}

interface CollectReviewParamsInput {
  args: string
  cwd: string
  hasUI: boolean
  currentModelId: string | undefined
  availableModelIds: string[]
  modelConfig: { chooseFrom: string[] } | undefined
  reviewInstructionsGlob: string
  notify: (message: string, level: 'info' | 'warning' | 'error') => void
  runWithCancellableLoader: <T>(args: {
    description: string
    run: (runArgs: { signal: AbortSignal }) => Promise<T>
  }) => Promise<T>
  showReviewForm: (
    form: ReviewFormData
  ) => Promise<ReviewFormResult | undefined>
}

export type ReviewParams =
  | {
      target: TargetSelection
      modelId?: string
      includeAgentsMd?: boolean
      reviewInstructions?: ReviewInstructionFile
    }
  | 'cancelled'

export async function collectReviewParams(
  params: CollectReviewParamsInput,
  deps = defaultDeps
): Promise<ReviewParams> {
  if (!params.hasUI) {
    if (params.args.trim() !== '') {
      return { target: { type: 'freeform', instructions: params.args.trim() } }
    }
    return { target: { type: 'uncommitted' } }
  }

  let customReviewTarget = params.args.trim()
  let selectedTarget: ReviewFormData['defaultTarget'] | undefined =
    customReviewTarget === '' ? undefined : 'freeform'
  let fetch = false
  for (;;) {
    if (fetch) {
      try {
        await params.runWithCancellableLoader({
          description: 'Fetching origin...',
          run: ({ signal }) => deps.fetchOrigin({ cwd: params.cwd, signal }),
        })
      } catch (error) {
        if (!isAbortError(error)) {
          const message = error instanceof Error ? error.message : String(error)
          params.notify(
            `Fetching origin failed, branch list may be stale: ${message}`,
            'warning'
          )
        }
      }
    }

    const form = await params.runWithCancellableLoader({
      description: 'Preparing review...',
      run: () =>
        deps.prepareReviewForm({
          cwd: params.cwd,
          currentModelId: params.currentModelId,
          availableModelIds: params.availableModelIds,
          modelConfig: params.modelConfig,
          reviewInstructionsGlob: params.reviewInstructionsGlob,
        }),
    })

    const displayForm = {
      ...form,
      ...(customReviewTarget === '' ? {} : { customReviewTarget }),
      ...(selectedTarget === undefined
        ? {}
        : { defaultTarget: selectedTarget }),
    }
    const result = await params.showReviewForm(displayForm)
    if (result === undefined) {
      return 'cancelled'
    }
    if ('action' in result) {
      customReviewTarget = result.customReviewTarget
      selectedTarget = result.selectedTarget
      fetch = true
      continue
    }
    return result
  }
}

collectReviewParams.defaultDeps = defaultDeps

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      ('code' in error && error.code === 'ABORT_ERR'))
  )
}
