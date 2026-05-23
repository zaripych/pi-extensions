export function selectReviewModel(params: {
  modelConfig: { chooseFrom: string[] } | undefined
  currentModelId: string | undefined
  availableModelIds: string[]
}): string {
  const candidates =
    params.modelConfig !== undefined
      ? params.modelConfig.chooseFrom
      : params.availableModelIds

  if (candidates.length === 0) {
    throw new Error('No models available for review.')
  }

  if (params.currentModelId !== undefined) {
    const exactDifferent = candidates.find((id) => id !== params.currentModelId)
    if (exactDifferent !== undefined) {
      const currentProvider = params.currentModelId.split('/')[0]
      const differentProvider = candidates.find(
        (id) => id.split('/')[0] !== currentProvider
      )
      return differentProvider ?? exactDifferent
    }
  }

  const first = candidates[0]
  if (first === undefined) {
    throw new Error('No models available for review.')
  }
  return first
}
