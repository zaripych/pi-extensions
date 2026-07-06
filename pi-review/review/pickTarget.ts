import { prepareReviewForm, type ReviewFormData } from './prepareReviewForm'
import type { ReviewFormResult } from './ReviewForm'

export type TargetSelection =
  | { type: 'uncommitted' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string }
  | { type: 'custom'; instructions: string }

const defaultDeps = {
  prepareReviewForm,
}

export interface PickTargetParams {
  args: string
  cwd: string
  hasUI: boolean
  currentModelId: string | undefined
  availableModelIds: string[]
  modelConfig: { chooseFrom: string[] } | undefined
  notify: (message: string, level: 'info' | 'warning' | 'error') => void
  runWithCancellableLoader: <T>(args: {
    description: string
    run: (runArgs: { signal: AbortSignal }) => Promise<T>
  }) => Promise<T>
  showReviewForm: (
    form: ReviewFormData
  ) => Promise<ReviewFormResult | 'fetch' | undefined>
}

export async function pickTarget(
  params: PickTargetParams,
  deps = defaultDeps
): Promise<
  | { target: TargetSelection; modelId?: string; includeAgents?: boolean }
  | 'cancelled'
> {
  if (params.args !== '') {
    return { target: { type: 'custom', instructions: params.args } }
  }

  if (!params.hasUI) {
    return { target: { type: 'uncommitted' } }
  }

  let fetch = false
  for (;;) {
    // ponytail: loader signal not wired into git fetch, esc waits for fetch to finish; pass signal to fetchOrigin if it matters
    const form = await params.runWithCancellableLoader({
      description: fetch ? 'Fetching origin...' : 'Preparing review...',
      run: () =>
        deps.prepareReviewForm({
          cwd: params.cwd,
          currentModelId: params.currentModelId,
          availableModelIds: params.availableModelIds,
          modelConfig: params.modelConfig,
          fetch,
        }),
    })

    if (form.fetchWarning !== undefined) {
      params.notify(form.fetchWarning, 'warning')
    }

    const result = await params.showReviewForm(form)
    if (result === undefined) {
      return 'cancelled'
    }
    if (result === 'fetch') {
      fetch = true
      continue
    }
    return result
  }
}

pickTarget.defaultDeps = defaultDeps
